import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

export function GraphPanel({ items }: { items: Array<Record<string, unknown>> }) {
  const nodes: Node[] = items.slice(0, 120).map((item, index) => ({
    id: typeof item.id === "string" ? item.id : `node-${index}`,
    position: { x: (index % 5) * 210, y: Math.floor(index / 5) * 110 },
    data: { label: typeof item.title === "string" ? item.title : typeof item.id === "string" ? item.id : `Node ${index + 1}` },
    className: "lore-node",
  }));
  const ids = new Set(nodes.map((node) => node.id));
  const edges: Edge[] = [];
  for (const item of items) {
    const source = typeof item.id === "string" ? item.id : undefined;
    const dependencies = Array.isArray(item.dependencies) ? item.dependencies : [];
    if (source === undefined) continue;
    for (const target of dependencies) {
      if (typeof target === "string" && ids.has(target)) edges.push({ id: `${source}-${target}`, source, target, animated: true });
    }
  }
  return <div className="graph-panel"><ReactFlow nodes={nodes} edges={edges} fitView minZoom={0.2} maxZoom={1.5}><Background color="#293431" /><Controls /></ReactFlow>{items.length > 120 && <span className="graph-truncated">僅顯示前120個節點</span>}</div>;
}
