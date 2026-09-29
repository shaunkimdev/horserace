type IconName =
  | "pencil"
  | "arrow"
  | "undo"
  | "trash"
  | "check"
  | "spark"
  | "flag"
  | "people"
  | "play"
  | "help"
  | "close"
  | "shield";

const paths: Record<IconName, string> = {
  pencil: "m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15v5Z",
  arrow: "M4 12h16m-6-6 6 6-6 6",
  undo: "M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12",
  trash: "M4 6h16M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7",
  check: "m5 12 4 4L19 6",
  spark: "m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z",
  flag: "M5 21V4m0 0c5-4 9 4 14 0v10c-5 4-9-4-14 0",
  people:
    "M16 21v-2a5 5 0 0 0-10 0v2M11 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM18 4a4 4 0 0 1 0 7m1 4a5 5 0 0 1 3 4v2",
  play: "m9 5 11 7-11 7V5Z",
  help: "M9 9a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  close: "m6 6 12 12M6 18 18 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Zm-4 9 3 3 5-6",
};

export default function StudioIcon({
  name,
  className = "",
}: {
  name: IconName;
  className?: string;
}) {
  return (
    <svg
      className={`studio-icon ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
