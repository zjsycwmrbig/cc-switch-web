import { TablePagination, useClientPagination } from "./TablePagination";
import { useTranslation } from "react-i18next";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useUserStats } from "@/lib/query/usage";
import type { UsageRangeSelection } from "@/types/usage";
import { fmtUsd } from "./format";

interface UserStatsTableProps {
  range: UsageRangeSelection;
  appType?: string;
  refreshIntervalMs: number;
}

export function UserStatsTable({
  range,
  appType,
  refreshIntervalMs,
}: UserStatsTableProps) {
  const { t } = useTranslation();
  const { data: stats, isLoading } = useUserStats(range, appType, {
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  const pagination = useClientPagination(
    [...(stats ?? [])].sort((a, b) =>
      a.username.localeCompare(b.username, undefined, { sensitivity: "base" }),
    ),
    JSON.stringify([range, appType]),
  );

  if (isLoading) {
    return <div className="h-[400px] animate-pulse rounded bg-gray-100" />;
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/50 bg-card/40 backdrop-blur-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("usage.user", "用户")}</TableHead>
            <TableHead className="text-right">
              {t("usage.requests", "请求数")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.tokens", "Tokens")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.cost", "成本")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.successRate", "成功率")}
            </TableHead>
            <TableHead className="text-right">
              {t("usage.avgLatency", "平均延迟")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats?.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={6}
                className="text-center text-muted-foreground"
              >
                {t("usage.noData", "暂无数据")}
              </TableCell>
            </TableRow>
          ) : (
            pagination.pageRows.map((stat) => (
              <TableRow key={stat.userId}>
                <TableCell className="font-medium">{stat.username}</TableCell>
                <TableCell className="text-right">
                  {stat.requestCount.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {stat.totalTokens.toLocaleString()}
                </TableCell>
                <TableCell className="text-right">
                  {fmtUsd(stat.totalCost, 4)}
                </TableCell>
                <TableCell className="text-right">
                  {stat.successRate.toFixed(1)}%
                </TableCell>
                <TableCell className="text-right">
                  {stat.avgLatencyMs}ms
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <TablePagination {...pagination} onPageChange={pagination.setPage} />
    </div>
  );
}
