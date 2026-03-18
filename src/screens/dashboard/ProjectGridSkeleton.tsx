export function ProjectGridSkeleton() {
  return (
    <div className="project-grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div
          key={index}
          className="project-skeleton"
          style={{ animationDelay: `${index * 0.08}s` }}
        />
      ))}
    </div>
  );
}
