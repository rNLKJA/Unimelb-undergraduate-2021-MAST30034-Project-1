import type { ReactNode } from "react";

/** Editorial page header: kicker, condensed headline, serif standfirst, double rule. */
export function PageHeader({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mx-auto max-w-7xl px-4 pt-10 sm:px-6">
      <p className="kicker text-taxi-text">{kicker}</p>
      <h1 className="font-condensed mt-2 text-5xl leading-[0.92] font-extrabold uppercase sm:text-6xl">
        {title}
      </h1>
      {children && <div className="prose-news text-foreground/85 mt-4 max-w-3xl text-lg">{children}</div>}
      <div className="rule-double mt-8" />
    </header>
  );
}

export function Section({
  id,
  kicker,
  title,
  children,
  intro,
}: {
  id: string;
  kicker?: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-h`}
      className="mx-auto max-w-7xl scroll-mt-20 px-4 pt-14 sm:px-6"
    >
      {kicker && <p className="kicker text-muted-foreground">{kicker}</p>}
      <h2
        id={`${id}-h`}
        className="font-condensed mt-1 border-b pb-2 text-3xl font-bold uppercase sm:text-4xl"
      >
        {title}
      </h2>
      {intro && (
        <div className="text-muted-foreground mt-3 max-w-3xl font-serif text-[16px] leading-relaxed">
          {intro}
        </div>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}

/** A boxed aside with a taxi-yellow rule. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="bg-card border-taxi rounded-r-md border-l-4 px-4 py-3">
      <p className="font-semibold">{title}</p>
      <div className="text-muted-foreground mt-1 font-serif text-[15px] leading-relaxed">{children}</div>
    </aside>
  );
}
