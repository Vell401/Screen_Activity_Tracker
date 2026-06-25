import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  title?: string;
  children: ReactNode;
  style?: CSSProperties;
}

/** Модульный блок-карточка на фоне --bg-app. */
export function Card({ title, children, style }: CardProps) {
  return (
    <section className="card" style={style}>
      {title && <header className="card__title">{title}</header>}
      <div className="card__body">{children}</div>
    </section>
  );
}
