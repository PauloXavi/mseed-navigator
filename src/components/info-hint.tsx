import { CircleAlert } from "lucide-react";
import type { SyntheticEvent } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GLOSSARY, type GlossaryKey } from "@/lib/glossary";
import { cn } from "@/lib/utils";

interface InfoHintProps {
  term: GlossaryKey;
  /** Alternatives listed one per line under the explanation (e.g. the other filter types). */
  related?: GlossaryKey[];
  className?: string;
}

// The popover is portaled, but React events still bubble to the hint's ancestors: a click
// must not toggle a neighbouring switch, sort a column or submit a form.
const stop = (event: SyntheticEvent) => event.stopPropagation();

/**
 * Small (!) button that opens a plain-language explanation of a technical term.
 * Opens on click/tap (a tooltip would need hover, which phones and tablets lack),
 * is reachable with Tab and closes with Esc. Keep it outside <Label htmlFor>.
 */
export function InfoHint({ term, related, className }: InfoHintProps) {
  const entry = GLOSSARY[term];
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`O que é ${entry.title}?`}
          onClick={stop}
          onPointerDown={stop}
          onKeyDown={stop}
          className={cn(
            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            className,
          )}
        >
          <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        collisionPadding={12}
        className="w-[min(20rem,calc(100vw-1.5rem))] space-y-2 p-3 text-xs leading-relaxed whitespace-pre-line normal-case tracking-normal"
        onClick={stop}
        onPointerDown={stop}
        onKeyDown={(event) => {
          // Esc must still reach Radix to close the popover.
          if (event.key !== "Escape") event.stopPropagation();
        }}
      >
        <div className="text-sm font-semibold text-foreground">{entry.title}</div>
        <p>
          <span className="block font-medium text-foreground">O que é:</span>
          {entry.what}
        </p>
        {entry.when && (
          <p>
            <span className="block font-medium text-foreground">Quando usar / como ler:</span>
            {entry.when}
          </p>
        )}
        {entry.example && (
          <p>
            <span className="block font-medium text-foreground">Exemplo:</span>
            {entry.example}
          </p>
        )}
        {related && related.length > 0 && (
          <div className="space-y-1 border-t pt-2">
            <div className="font-medium text-foreground">Outras opções:</div>
            <ul className="space-y-0.5">
              {related.map((key) => (
                <li key={key}>
                  <span className="font-medium text-foreground">{GLOSSARY[key].title}:</span>{" "}
                  {GLOSSARY[key].what}
                </li>
              ))}
            </ul>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Label text followed by its (!) hint, kept outside the <label> element. */
export function HintLabel({
  term,
  children,
  className,
}: {
  term: GlossaryKey;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {children}
      <InfoHint term={term} />
    </span>
  );
}
