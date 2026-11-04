//! zeno-enclave-agent: runs inside the Instant Sync Nitro Enclave.
//!
//!   zeno-enclave-agent attest --nonce <hex> --public-key <base64 SPKI>
//!       Asks the Nitro Secure Module for an attestation document binding the nonce and the
//!       server's in-memory public key. Prints the document as base64.
//!
//!   zeno-enclave-agent init -- <command...>
//!       Enclave entrypoint. Brings up loopback, points the lightwalletd hostname at 127.0.0.1,
//!       starts two bridges, then runs <command> (the Node server) and exits with it:
//!         inbound   vsock :APP_VSOCK_PORT (8790)  ->  tcp 127.0.0.1:APP_PORT (8790)
//!         outbound  tcp 127.0.0.1:443             ->  vsock parent(3):LWD_VSOCK_PORT (8443)
//!       The parent runs `vsock-proxy 8443 <lwd host> 443`. TLS to lightwalletd is end-to-end
//!       from inside the enclave, so the parent only relays ciphertext.

use std::io::{self, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{exit, Command};
use std::thread;

use aws_nitro_enclaves_nsm_api::api::{Request, Response};
use aws_nitro_enclaves_nsm_api::driver::{nsm_exit, nsm_init, nsm_process_request};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use serde_bytes::ByteBuf;
use vsock::{VsockAddr, VsockListener, VsockStream, VMADDR_CID_ANY};

const PARENT_CID: u32 = 3;

fn env_u32(name: &str, default: u32) -> u32 {
    std::env::var(name).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

fn die(msg: impl AsRef<str>) -> ! {
    eprintln!("zeno-enclave-agent: {}", msg.as_ref());
    exit(1)
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    if s.len() % 2 != 0 {
        return None;
    }
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).ok()).collect()
}

fn attest(args: &[String]) {
    let flag = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).cloned();
    let nonce = flag("--nonce").and_then(|n| hex_decode(&n)).unwrap_or_else(|| die("--nonce <hex> required"));
    let public_key = flag("--public-key")
        .and_then(|k| B64.decode(k).ok())
        .unwrap_or_else(|| die("--public-key <base64> required"));
    if nonce.len() > 512 || public_key.len() > 1024 {
        die("nonce or public key too large");
    }
    let fd = nsm_init();
    if fd < 0 {
        die("cannot open /dev/nsm (not running in a Nitro Enclave?)");
    }
    let request = Request::Attestation {
        user_data: None,
        nonce: Some(ByteBuf::from(nonce)),
        public_key: Some(ByteBuf::from(public_key)),
    };
    let response = nsm_process_request(fd, request);
    nsm_exit(fd);
    match response {
        Response::Attestation { document } => println!("{}", B64.encode(document)),
        Response::Error(code) => die(format!("NSM error: {code:?}")),
        _ => die("unexpected NSM response"),
    }
}

/// `ip link set lo up` without iproute2. The kernel adds 127.0.0.1/8 when loopback comes up.
fn loopback_up() -> io::Result<()> {
    unsafe {
        let sock = libc::socket(libc::AF_INET, libc::SOCK_DGRAM, 0);
        if sock < 0 {
            return Err(io::Error::last_os_error());
        }
        let mut ifr: libc::ifreq = std::mem::zeroed();
        for (i, b) in b"lo\0".iter().enumerate() {
            ifr.ifr_name[i] = *b as libc::c_char;
        }
        let mut rc = libc::ioctl(sock, libc::SIOCGIFFLAGS as _, &mut ifr);
        if rc == 0 {
            ifr.ifr_ifru.ifru_flags |= libc::IFF_UP as libc::c_short;
            rc = libc::ioctl(sock, libc::SIOCSIFFLAGS as _, &ifr);
        }
        let err = io::Error::last_os_error();
        libc::close(sock);
        if rc < 0 {
            return Err(err);
        }
    }
    Ok(())
}

fn pipe<A, B>(mut a: A, mut b: B)
where
    A: Read + Write + Send + 'static + TryCloneShutdown,
    B: Read + Write + Send + 'static + TryCloneShutdown,
{
    let (mut a2, mut b2) = match (a.try_clone_box(), b.try_clone_box()) {
        (Ok(a2), Ok(b2)) => (a2, b2),
        _ => return,
    };
    let t = thread::spawn(move || {
        let _ = io::copy(&mut a2, &mut b2);
        b2.shutdown_write();
    });
    let _ = io::copy(&mut b, &mut a);
    a.shutdown_write();
    let _ = t.join();
}

trait TryCloneShutdown: Sized {
    fn try_clone_box(&self) -> io::Result<Self>;
    fn shutdown_write(&self);
}
impl TryCloneShutdown for TcpStream {
    fn try_clone_box(&self) -> io::Result<Self> {
        self.try_clone()
    }
    fn shutdown_write(&self) {
        let _ = self.shutdown(Shutdown::Write);
    }
}
impl TryCloneShutdown for VsockStream {
    fn try_clone_box(&self) -> io::Result<Self> {
        self.try_clone()
    }
    fn shutdown_write(&self) {
        let _ = self.shutdown(Shutdown::Write);
    }
}

fn init(cmd: &[String]) {
    if cmd.is_empty() {
        die("usage: init -- <command...>");
    }
    loopback_up().unwrap_or_else(|e| die(format!("loopback: {e}")));

    // Resolve lightwalletd to the outbound bridge. TLS still verifies the real hostname.
    let lwd_hosts = std::env::var("LWD_HOSTS").unwrap_or_else(|_| "testnet.zec.rocks".into());
    let hosts = format!("127.0.0.1 localhost\n127.0.0.1 {}\n", lwd_hosts.split(',').collect::<Vec<_>>().join(" "));
    std::fs::write("/etc/hosts", hosts).unwrap_or_else(|e| die(format!("/etc/hosts: {e}")));

    let app_vsock = env_u32("APP_VSOCK_PORT", 8790);
    let app_port = env_u32("APP_PORT", 8790);
    let lwd_vsock = env_u32("LWD_VSOCK_PORT", 8443);

    let inbound = VsockListener::bind(&VsockAddr::new(VMADDR_CID_ANY, app_vsock))
        .unwrap_or_else(|e| die(format!("vsock listen {app_vsock}: {e}")));
    thread::spawn(move || {
        for conn in inbound.incoming().flatten() {
            thread::spawn(move || {
                if let Ok(tcp) = TcpStream::connect(("127.0.0.1", app_port as u16)) {
                    pipe(conn, tcp);
                }
            });
        }
    });

    let outbound = TcpListener::bind("127.0.0.1:443").unwrap_or_else(|e| die(format!("tcp listen 443: {e}")));
    thread::spawn(move || {
        for conn in outbound.incoming().flatten() {
            thread::spawn(move || {
                if let Ok(vs) = VsockStream::connect(&VsockAddr::new(PARENT_CID, lwd_vsock)) {
                    pipe(conn, vs);
                }
            });
        }
    });

    eprintln!("zeno-enclave-agent: bridges up (vsock:{app_vsock} -> 127.0.0.1:{app_port}, 127.0.0.1:443 -> parent:{lwd_vsock})");
    let status = Command::new(&cmd[0]).args(&cmd[1..]).status().unwrap_or_else(|e| die(format!("spawn {}: {e}", cmd[0])));
    exit(status.code().unwrap_or(1));
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    match args.first().map(String::as_str) {
        Some("attest") => attest(&args[1..]),
        Some("init") => {
            let rest = if args.get(1).map(String::as_str) == Some("--") { &args[2..] } else { &args[1..] };
            init(rest)
        }
        _ => die("usage: attest --nonce <hex> --public-key <b64> | init -- <command...>"),
    }
}
