import { APP_NAME } from "@/lib/brand";

/** Brand wordmark: "VIVOMUSICANO." with the accent dot. Size and layout come from `className`. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`font-display tracking-wide text-white ${className}`}>
      {APP_NAME.toUpperCase()}
      <span className="text-accent">.</span>
    </span>
  );
}
