import type { ButtonHTMLAttributes } from "react";

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  // Defaults to type="button": HTML defaults a bare <button> to
  // type="submit", so any instance rendered inside a <form> (Phase 2
  // onward) would submit that form on click unless every call site
  // remembered to override it. Still overridable via props since `type`
  // is destructured before the spread.
  const variantClass = variant === "primary" ? "v1-btn v1-btn--primary" : "v1-btn";
  return (
    <button
      type={type}
      className={className ? `${variantClass} ${className}` : variantClass}
      {...props}
    />
  );
}
