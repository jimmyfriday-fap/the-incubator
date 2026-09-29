export function compute(expr: string): unknown {
  return new Function(`return (${expr})`)();
}
