// Delivered by Originkit · stack: nextjs · styling: tailwind
/* eslint-disable */
// @ts-nocheck
"use client"

import { useEffect, useRef, useState } from "react"
import { ZenoMark } from "@/components/brand/zeno-mark"
import ChromaticDrift from "@/components/originkit/ui/hero-62/chromatic-drift"

export const T = 195 // tile size in viewBox units (1 unit = 1px at the 2400px reference width)
export const GRID_ROWS = 2 // visible tile rows; the frame is sized to this band
export const GRID_SKIP = 1 // start on the spiral row so the shorter band keeps the centerpiece
// . empty  l "/" hatch  r "\" hatch  m fine mesh  v chevrons  C concentric block (drawn separately)
const MAP = ["l.l.rm.l.rll", ".l..CCC.ll.l", "l.rl.Cml.l.l", ".l.lr.vl.l.."]
const FILL: Record<string, string> = { l: "url(#hl)", r: "url(#hr)", m: "url(#mesh)", v: "url(#chev)" }

// One SVG body, used twice: grey on the page, white as the alpha mask that lets the drift through the lines only.
export function gridSvg(stroke: string, mask: boolean, rows: number): string {
    const k = mask ? 2.4 : 1 // mask lines are thicker so the colour reads as solid
    let s =
        `<defs>` +
        `<pattern id="hl" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2,2 l4,-4 M0,8 l8,-8 M6,10 l4,-4" stroke="${stroke}" stroke-width="${1.4 * k}"/></pattern>` +
        `<pattern id="hr" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-2,6 l4,4 M0,0 l8,8 M6,-2 l4,4" stroke="${stroke}" stroke-width="${1.4 * k}"/></pattern>` +
        `<pattern id="mesh" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M0,7 L7,0 M0,0 L7,7" stroke="${stroke}" stroke-width="${0.7 * k}"/></pattern>` +
        `<pattern id="chev" width="16" height="8" patternUnits="userSpaceOnUse"><path d="M0,0 L8,8 L16,0" fill="none" stroke="${stroke}" stroke-width="${1.4 * k}"/></pattern>` +
        `<clipPath id="cblock"><rect x="${4 * T}" y="${T}" width="${3 * T}" height="${T}"/><rect x="${5 * T}" y="${2 * T}" width="${T}" height="${T}"/></clipPath>` +
        `</defs>`
    for (let r = 0; r < rows; r++)
        [...MAP[r % 4]].forEach((ch, c) => {
            if (ch === "C") { if (r < 4) return; ch = "l" } // concentric block only in the first band; below it the map repeats
            if (mask && ch === ".") return
            s += `<rect x="${c * T}" y="${r * T}" width="${T}" height="${T}" fill="${FILL[ch] ?? "#0a0a0a"}"/>`
        })
    s += `<g clip-path="url(#cblock)" fill="none" stroke="${stroke}" stroke-width="${1.4 * k}">`
    for (let h = 390; h > 0; h -= 8) s += `<rect x="${1150 - h}" y="${390 - h}" width="${2 * h}" height="${2 * h}"/>`
    return s + `</g>`
}

interface HeroProps {
    brand?: string
    drift?: boolean // Chromatic Drift glowing through the grid lines
}

export default function Hero({ brand = "Zeno", drift = true }: HeroProps) {
    const frameRef = useRef<HTMLDivElement>(null)
    const gridRef = useRef<SVGSVGElement>(null)
    const [gridH, setGridH] = useState<number | undefined>()

    useEffect(() => {
        const frame = frameRef.current
        if (!frame) return
        const layout = () => {
            const tile = (frame.clientWidth * 0.973) / 12
            setGridH(GRID_ROWS * tile)
        }
        const ro = new ResizeObserver(layout)
        ro.observe(frame)
        layout()
        return () => ro.disconnect()
    }, [])

    const drawn = GRID_SKIP + GRID_ROWS
    const view = `0 ${GRID_SKIP * T} ${12 * T} ${GRID_ROWS * T}`
    const mask = `url("data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view}">${gridSvg("#fff", true, drawn)}</svg>`)}")`

    return (
        <section className="hero">
            <div ref={frameRef} className="hero__frame">
                {drift && (
                    <div className="hero__drift" style={{ height: gridH, WebkitMaskImage: mask, maskImage: mask, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", WebkitMaskRepeat: "no-repeat", maskRepeat: "no-repeat" }}>
                        <ChromaticDrift
                            speed={30}
                            background="#140E08"
                            baseColor="#E8941A"
                            accentColor="#FF7A18"
                            advanced={{
                                driftPct: 24,
                                wobbleRate: 300,
                                pink: "#FFE566",
                                lilac: "#FFC14A",
                                coral: "#FF8C2A",
                                maroon: "#8C2E08",
                                indigo: "#3D1A08",
                                violet: "#FFB020",
                                botLight: "#FFF1B8",
                                botBlue: "#FFD56A",
                                botEmber: "#F06A12",
                                botRed: "#C2410C",
                                botWine: "#4A1C08",
                                botPurple: "#E8941A",
                                topTint: "#FFB000",
                                floorColor: "#6B2408",
                            }}
                        />
                    </div>
                )}
                <div className="hero__content">
                    <nav className="hero__nav">
                        <ul>
                            <li><a href="#privacy">Privacy</a></li>
                            <li><a href="#inside">Inside</a></li>
                            <li><a href="/pay/send">Payments</a></li>
                        </ul>
                        <a className="hero__logo" href="/" aria-label={`${brand} home`}>
                            <ZenoMark />
                        </a>
                        <ul>
                            <li><a href="#instant">Instant Sync</a></li>
                            <li><a href="/audit">Auditor</a></li>
                            <li><a href="/dashboard">Open wallet</a></li>
                        </ul>
                    </nav>
                    <h1 className="hero__title">
                        <span>Your money.</span>
                        <span>Your rules.</span>
                        <span>Shielded ZEC.</span>
                    </h1>
                    <a className="hero__cta" href="/dashboard">[ Enter Zeno Wallet ]</a>
                    <svg ref={gridRef} className="hero__grid" style={{ height: gridH }} viewBox={view} preserveAspectRatio="xMinYMin meet" aria-hidden dangerouslySetInnerHTML={{ __html: gridSvg("#8a8a8a", false, drawn) }} />
                </div>
            </div>
        </section>
    )
}
