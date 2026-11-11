"use client";

/** Learn/exam stay open after pass; missions route retired → profile hub. */
export function ExamAccessGate({
  children,
}: {
  mode?: "learn-exam" | "missions";
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
