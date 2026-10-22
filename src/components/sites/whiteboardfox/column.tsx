/**
 * The source site uses a fixed 1010px content column at every breakpoint, so the
 * clone keeps the same non-responsive measure instead of a fluid container.
 */
export function Column({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`w-[1010px] mx-auto h-full ${className}`}>{children}</div>
  );
}
