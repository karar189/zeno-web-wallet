import Image from "next/image";

export function TokenMark({
  symbol,
  size = 32,
}: {
  symbol: string;
  size?: number;
}) {
  if (symbol === "ZEC" || symbol === "USDC" || symbol === "USDT") {
    const src =
      symbol === "ZEC"
        ? "/logos/zcash-coingecko.png"
        : symbol === "USDC"
          ? "/logos/usdc.svg"
          : "/logos/usdt.svg";
    return (
      <Image
        src={src}
        alt=""
        width={size}
        height={size}
        className="token-logo"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span className="token-letter" style={{ width: size, height: size }}>
      {symbol.slice(0, 1)}
    </span>
  );
}
