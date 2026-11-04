"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

type Slice = {
  name: string;
  value: number;
  color: string;
};

type Props = {
  shieldedZatoshis: string | null | undefined;
  transparentZatoshis: string | null | undefined;
  emptyLabel?: string;
};

function toNumber(value: string | null | undefined): number {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return 0;
  }
  return Number(value);
}

export function PoolSplitChart({
  shieldedZatoshis,
  transparentZatoshis,
  emptyLabel = "No pool balances to chart yet",
}: Props) {
  const shielded = toNumber(shieldedZatoshis);
  const transparent = toNumber(transparentZatoshis);
  const data: Slice[] = [
    { name: "Shielded", value: shielded, color: "#ffc14a" },
    { name: "Transparent", value: transparent, color: "#8c8c8c" },
  ].filter((slice) => slice.value > 0);

  if (!data.length) {
    return (
      <div className="desk-chart-empty" role="status">
        <span className="eyebrow">Pool split</span>
        <p>{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div className="desk-chart">
      <div className="desk-chart-head">
        <span className="eyebrow">Pool split</span>
        <span className="desk-chart-caption">From live vault balances</span>
      </div>
      <div className="desk-chart-body desk-chart-body-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius="58%"
              outerRadius="82%"
              paddingAngle={2}
              stroke="#0a0a0a"
              strokeWidth={2}
            >
              {data.map((slice) => (
                <Cell key={slice.name} fill={slice.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "#0a0a0a",
                border: "1px solid rgba(244,241,234,0.22)",
                borderRadius: 0,
                color: "#f7f4ef",
                fontSize: 12,
              }}
              formatter={(value) => [
                typeof value === "number" ? `${value} zat` : String(value),
                "",
              ]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="desk-chart-legend">
        {data.map((slice) => (
          <li key={slice.name}>
            <i style={{ background: slice.color }} />
            <span>{slice.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
