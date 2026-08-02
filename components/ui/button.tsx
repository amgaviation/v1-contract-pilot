import type { ButtonHTMLAttributes } from "react";

export function Button({
  variant = "secondary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
}) {
  const variantClass = variant === "primary" ? "v1-btn v1-btn--primary" : "v1-btn";
  return (
    <button
      className={className ? `${variantClass} ${className}` : variantClass}
      {...props}
    />
  );
}
