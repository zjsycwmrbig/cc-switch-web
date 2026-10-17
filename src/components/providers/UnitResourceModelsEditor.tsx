import { Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { unit, type Model } from "@/components/unit/client";

interface UnitResourceModelsEditorProps {
  resourceId: string;
  models: Model[];
  onChange: (models: Model[]) => void;
}

export function UnitResourceModelsEditor({
  resourceId,
  models,
  onChange,
}: UnitResourceModelsEditorProps) {
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const rows = await unit<Model[]>(
        `/resources/${encodeURIComponent(resourceId)}/models/refresh`,
        "POST",
      );
      onChange(rows);
      toast.success(`已获取 ${rows.length} 个模型`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setRefreshing(false);
    }
  };

  const update = (index: number, patch: Partial<Model>) => {
    onChange(models.map((model, i) => (i === index ? { ...model, ...patch } : model)));
  };

  return (
    <section className="mb-5 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">供应商模型</h3>
          <p className="text-xs text-muted-foreground">
            这里保存的是供应商目录，修改后所有已获授权用户同步生效。
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => onChange([...models, { slug: "", display_name: "" }])}>
            <Plus className="mr-1 h-4 w-4" />
            添加模型
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
            <RefreshCw className={`mr-1 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            获取模型
          </Button>
        </div>
      </div>
      <div className="space-y-2">
        {models.map((model, index) => (
          <div key={`${model.slug}-${index}`} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <Input
              value={model.slug}
              placeholder="上游模型 ID"
              onChange={(event) => update(index, { slug: event.target.value })}
            />
            <Input
              value={model.display_name ?? ""}
              placeholder="展示名（可选）"
              onChange={(event) => update(index, { display_name: event.target.value })}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`删除模型 ${model.slug || index + 1}`}
              onClick={() => onChange(models.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        ))}
        {models.length === 0 && (
          <p className="py-3 text-sm text-muted-foreground">暂无模型，请点击“获取模型”或手动添加。</p>
        )}
      </div>
    </section>
  );
}
