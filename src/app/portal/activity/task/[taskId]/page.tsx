"use client";

import { AuthGuard } from "@/app/components/AuthGuard";
import { ActivityTaskReportForm } from "@/app/components/ActivityTaskReportForm";
import { useIctStore } from "@/contexts/IctStore";
import { useParams } from "next/navigation";

function ReportInner() {
  const { session } = useIctStore();
  const params = useParams();
  const taskId = String(params?.taskId ?? "");
  const candidate = session?.kind === "candidate" ? session.candidate : null;
  if (!candidate || !taskId) return null;
  return <ActivityTaskReportForm candidate={candidate} taskId={taskId} />;
}

export default function ActivityTaskReportPage() {
  return (
    <AuthGuard requirePortalRoles={["user", "school_admin"]}>
      <ReportInner />
    </AuthGuard>
  );
}
