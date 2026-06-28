import type { CSSProperties, ReactNode } from "react";

interface CardProps {
  title?: string;
  subtitle?: string;
  /** Контент в правой части шапки (кнопки, переключатели). */
  actions?: ReactNode;
  children: ReactNode;
  style?: CSSProperties;
  className?: string;
}

/** Модульный блок-карточка на фоне приложения. */
export function Card({
  title,
  subtitle,
  actions,
  children,
  style,
  className,
}: CardProps) {
  return (
    <section className={"card" + (className ? " " + className : "")} style={style}>
      {(title || actions) && (
        <header className="card__head">
          <div className="card__heading">
            {title && <span className="card__title">{title}</span>}
            {subtitle && <span className="card__subtitle">{subtitle}</span>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}
