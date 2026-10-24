"use client";

import React from "react";
import Link from "next/link";
import { Globe2, Activity, PlaySquare, RefreshCw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { NormalizedReadiness } from "@/lib/meta/normalizeMetaHealth";

export interface MetaWorkspaceHeaderProps {
  readiness: NormalizedReadiness;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenDiagnostics: () => void;
}

export const MetaWorkspaceHeader: React.FC<MetaWorkspaceHeaderProps> = ({
  readiness,
  isRefreshing,
  onRefresh,
  onOpenDiagnostics,
}) => {
  return (
    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
      <div className="space-y-1">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-100 tracking-tight flex items-center gap-2.5">
            <Globe2 className="h-6 w-6 text-indigo-400 shrink-0" />
            <span>Meta Ads Research</span>
          </h1>
          <Badge variant={readiness.badgeVariant} dot>
            {readiness.title}
          </Badge>
        </div>
        <p className="text-xs sm:text-sm text-slate-400 max-w-2xl leading-relaxed">
          Discover, collect, and analyze US public advertisements from Meta Ad Library using your local collector.
        </p>
      </div>

      <div className="flex items-center gap-2.5 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenDiagnostics}
          leftIcon={<Activity className="h-3.5 w-3.5 text-indigo-400" />}
        >
          Diagnostics
        </Button>

        <Button
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={isRefreshing}
          leftIcon={
            isRefreshing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 text-slate-400" />
            )
          }
        >
          Refresh
        </Button>

        <Link href="/explorer">
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<PlaySquare className="h-3.5 w-3.5 text-emerald-400" />}
          >
            Ads Explorer
          </Button>
        </Link>
      </div>
    </div>
  );
};
