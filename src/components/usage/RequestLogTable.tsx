import { RequestDetailPanel } from "./RequestDetailPanel";
import { TablePagination } from "./TablePagination";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRequestLogs } from "@/lib/query/usage";
import type { LogFilters, UsageRangeSelection } from "@/types/usage";
import { Search, X } from "lucide-react";
import { UsageDateRangePicker } from "./UsageDateRangePicker";
import {
  formatOutputTokensPerSecond,
  formatEstimatedTokensPerSecond,
  fmtInt,
  fmtUsd,
  getLocaleFromLanguage,
  parseFiniteNumber,
} from "./format";

interface RequestLogTableProps {
  range: UsageRangeSelection;
  rangeLabel: string;
  appType?: string;
  refreshIntervalMs: number;
  onRangeChange?: (range: UsageRangeSelection) => void;
}

export function RequestLogTable({
  range,
  rangeLabel,
  appType: dashboardAppType,
  refreshIntervalMs,
  onRangeChange,
}: RequestLogTableProps) {
  const { t, i18n } = useTranslation();

  const [appliedFilters, setAppliedFilters] = useState<LogFilters>({});
  const [draftFilters, setDraftFilters] = useState<LogFilters>({});
  const [page, setPage] = useState(0);
  const [selectedRequest, setSelectedRequest] = useState<string | null>(null);
  const pageSize = 20;

  const dashboardAppTypeActive = dashboardAppType && dashboardAppType !== "all";
  const effectiveFilters: LogFilters = dashboardAppTypeActive
    ? { ...appliedFilters, appType: dashboardAppType }
    : appliedFilters;

  const {
    data: result,
    isLoading,
    isPlaceholderData,
  } = useRequestLogs({
    filters: effectiveFilters,
    range,
    page,
    pageSize,
    options: {
      refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
    },
  });

  const logs = result?.data ?? [];
  const total = result?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    setPage(0);
  }, [
    dashboardAppType,
    range.customEndDate,
    range.customStartDate,
    range.preset,
  ]);

  useEffect(() => {
    if (result && !isPlaceholderData)
      setPage((current) => Math.min(current, totalPages - 1));
  }, [result, isPlaceholderData, totalPages]);

  const handleSearch = () => {
    setAppliedFilters(draftFilters);
    setPage(0);
  };

  const handleReset = () => {
    setDraftFilters({});
    setAppliedFilters({});
    setPage(0);
  };

  const applySelectFilter = <K extends keyof LogFilters>(
    key: K,
    value: LogFilters[K],
  ) => {
    setDraftFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setAppliedFilters((prev) => ({
      ...prev,
      [key]: value,
    }));
    setPage(0);
  };

  const language = i18n.resolvedLanguage || i18n.language || "en";
  const locale = getLocaleFromLanguage(language);

  return (
    <div className="space-y-4">
      {selectedRequest && (
        <RequestDetailPanel
          requestId={selectedRequest}
          onClose={() => setSelectedRequest(null)}
        />
      )}
      <div className="rounded-lg border bg-card/50 p-2 backdrop-blur-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <Select
            value={
              dashboardAppTypeActive
                ? dashboardAppType
                : draftFilters.appType || "all"
            }
            onValueChange={(v) =>
              applySelectFilter("appType", v === "all" ? undefined : v)
            }
            disabled={!!dashboardAppTypeActive}
          >
            <SelectTrigger className="h-8 w-[110px] bg-background text-xs">
              <SelectValue placeholder={t("usage.appType")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("usage.allApps")}</SelectItem>
              <SelectItem value="claude">Claude</SelectItem>
              <SelectItem value="codex">Codex</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={draftFilters.statusCode?.toString() || "all"}
            onValueChange={(v) =>
              applySelectFilter(
                "statusCode",
                v === "all"
                  ? undefined
                  : Number.isFinite(Number.parseInt(v, 10))
                    ? Number.parseInt(v, 10)
                    : undefined,
              )
            }
          >
            <SelectTrigger className="h-8 w-[100px] bg-background text-xs">
              <SelectValue placeholder={t("usage.statusCode")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="200">200 OK</SelectItem>
              <SelectItem value="400">400</SelectItem>
              <SelectItem value="401">401</SelectItem>
              <SelectItem value="429">429</SelectItem>
              <SelectItem value="500">500</SelectItem>
            </SelectContent>
          </Select>

          <div className="relative min-w-[140px] flex-1">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("usage.searchUserPlaceholder", {
                defaultValue: "Search user...",
              })}
              className="h-8 bg-background pl-7 text-xs"
              value={draftFilters.username || ""}
              onChange={(e) =>
                setDraftFilters({
                  ...draftFilters,
                  username: e.target.value || undefined,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
          </div>

          <div className="relative min-w-[140px] flex-1">
            <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder={t("usage.searchProviderPlaceholder")}
              className="h-8 bg-background pl-7 text-xs"
              value={draftFilters.providerName || ""}
              onChange={(e) =>
                setDraftFilters({
                  ...draftFilters,
                  providerName: e.target.value || undefined,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
          </div>

          <div className="relative min-w-[120px] flex-1">
            <Input
              placeholder={t("usage.searchModelPlaceholder")}
              className="h-8 bg-background text-xs"
              value={draftFilters.model || ""}
              onChange={(e) =>
                setDraftFilters({
                  ...draftFilters,
                  model: e.target.value || undefined,
                })
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSearch();
              }}
            />
          </div>

          {onRangeChange && (
            <UsageDateRangePicker
              selection={range}
              triggerLabel={rangeLabel}
              onApply={onRangeChange}
            />
          )}

          <Button
            size="icon"
            variant="default"
            onClick={handleSearch}
            className="h-8 w-8"
            title={t("common.search")}
          >
            <Search className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="outline"
            onClick={handleReset}
            className="h-8 w-8"
            title={t("common.reset")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="h-[400px] animate-pulse rounded bg-gray-100" />
      ) : (
        <>
          <div className="rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.time")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.user", { defaultValue: "User" })}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.provider")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.billingModel")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.inputTokens")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.outputTokens")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.totalCost")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.timingInfo")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.status")}
                  </TableHead>
                  <TableHead className="text-center whitespace-nowrap">
                    {t("usage.source", { defaultValue: "Source" })}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="text-center text-muted-foreground"
                    >
                      {t("usage.noData")}
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.requestId}>
                      <TableCell className="w-px text-center whitespace-nowrap text-xs px-1.5">
                        <button
                          type="button"
                          className="hover:underline focus-visible:underline"
                          aria-label={`${t("usage.requestDetail")}: ${log.requestId}`}
                          onClick={() => setSelectedRequest(log.requestId)}
                        >
                          {new Date(log.createdAt * 1000).toLocaleString(
                            locale,
                            {
                              month: "2-digit",
                              day: "2-digit",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          )}
                        </button>
                      </TableCell>
                      <TableCell className="w-[12%] max-w-0 text-center">
                        <span
                          className="block truncate font-medium"
                          title={log.username || "-"}
                        >
                          {log.username || "-"}
                        </span>
                        {log.device && (
                          <span
                            className="block truncate text-xs text-muted-foreground"
                            title={log.device}
                          >
                            {log.device}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="w-[18%] max-w-0 text-center">
                        <span
                          className="block truncate"
                          title={log.providerName}
                        >
                          {log.providerName || t("usage.unknownProvider")}
                        </span>
                      </TableCell>
                      <TableCell className="w-[22%] max-w-0 text-center font-mono text-xs">
                        <div
                          className="truncate"
                          title={
                            log.requestModel && log.requestModel !== log.model
                              ? `${log.requestModel} → ${log.model}`
                              : log.model
                          }
                        >
                          {log.requestModel &&
                          log.requestModel !== log.model ? (
                            <span>
                              {log.requestModel}
                              <span className="text-muted-foreground">
                                {" → "}
                                {log.model}
                              </span>
                            </span>
                          ) : (
                            log.model
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-center px-1.5">
                        <div className="tabular-nums">
                          {fmtInt(log.inputTokens, locale)}
                        </div>
                        {(log.cacheReadTokens > 0 ||
                          log.cacheCreationTokens > 0) && (
                          <div className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {[
                              log.cacheReadTokens > 0 &&
                                `R${fmtInt(log.cacheReadTokens, locale)}`,
                              log.cacheCreationTokens > 0 &&
                                `W${fmtInt(log.cacheCreationTokens, locale)}`,
                            ]
                              .filter(Boolean)
                              .join("·")}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-center px-1.5">
                        <div className="tabular-nums">
                          {fmtInt(log.outputTokens, locale)}
                          {(() => {
                            const exact = formatOutputTokensPerSecond(log);
                            const estimated =
                              formatEstimatedTokensPerSecond(log);
                            const tpsStr =
                              exact ??
                              (estimated == null ? null : `≈${estimated}`);
                            if (tpsStr == null) return null;
                            return (
                              <span className="text-muted-foreground text-xs">
                                /{tpsStr} tps
                              </span>
                            );
                          })()}
                        </div>
                      </TableCell>
                      <TableCell className="text-center px-1.5">
                        <div className="font-medium tabular-nums">
                          {log.costUnknown
                            ? "未定价"
                            : fmtUsd(log.totalCostUsd, 4)}
                        </div>
                        {parseFiniteNumber(log.costMultiplier) != null &&
                          parseFiniteNumber(log.costMultiplier) !== 1 && (
                            <div className="text-[11px] text-muted-foreground">
                              ×
                              {parseFiniteNumber(log.costMultiplier)?.toFixed(
                                2,
                              )}
                            </div>
                          )}
                      </TableCell>
                      <TableCell className="text-center whitespace-nowrap text-xs tabular-nums">
                        {(log.latencyMs / 1000).toFixed(1)}s
                        {log.firstTokenMs != null && (
                          <span className="text-muted-foreground">
                            /{(log.firstTokenMs / 1000).toFixed(1)}s
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            log.statusCode >= 200 && log.statusCode < 300
                              ? "text-green-600"
                              : "text-red-600"
                          }
                        >
                          {log.statusCode}
                        </span>
                      </TableCell>
                      <TableCell className="text-center text-xs text-muted-foreground">
                        {log.dataSource || "proxy"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          <TablePagination
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
