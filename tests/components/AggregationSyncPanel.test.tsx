import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AggregationSyncPanel } from "@/components/providers/AggregationSyncPanel";

const mocks = vi.hoisted(() => ({
  unit: vi.fn(),
  session: {
    current: { user: { id: "user-1" } } as unknown,
  },
}));

vi.mock("@/components/unit/client", () => ({
  unit: mocks.unit,
}));

vi.mock("@/components/unit/session", () => ({
  useUnitSession: () => mocks.session.current,
}));

vi.mock("@/lib/runtime/client/web", () => ({
  downloadWebAggregationModels: vi.fn(),
  getWebAccessKey: () => "",
  getWebApiBase: () => "https://cc-switch.example.com",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

describe("AggregationSyncPanel model catalog", () => {
  beforeEach(() => {
    mocks.unit.mockReset();
    mocks.session.current = { user: { id: "user-1" } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("展示当前 Codex 目录中的模型名称和 slug", async () => {
    mocks.unit.mockResolvedValue({
      models: [
        {
          slug: "ccs-a/deepseek-v4",
          display_name: "DeepSeek V4",
        },
        {
          slug: "ccs-auto/kimi-k2",
          display_name: "Kimi K2",
        },
      ],
      default_model: "ccs-a/deepseek-v4",
      warnings: [],
    });

    render(<AggregationSyncPanel />);

    expect(await screen.findByText("DeepSeek V4")).toBeInTheDocument();
    expect(screen.getByText("ccs-a/deepseek-v4")).toBeInTheDocument();
    expect(screen.getByText("Kimi K2")).toBeInTheDocument();
    expect(screen.getByText("2 个")).toBeInTheDocument();
    expect(screen.getByText("默认")).toBeInTheDocument();
    expect(mocks.unit).toHaveBeenCalledWith("/catalog");
  });

  it("保存选择或路由变化后使用 refreshKey 重新读取目录", async () => {
    mocks.unit
      .mockResolvedValueOnce({
        models: [{ slug: "ccs-a/old", display_name: "旧模型" }],
      })
      .mockResolvedValueOnce({
        models: [{ slug: "ccs-a/new", display_name: "新模型" }],
      });

    const view = render(<AggregationSyncPanel refreshKey={0} />);
    expect(await screen.findByText("旧模型")).toBeInTheDocument();

    view.rerender(<AggregationSyncPanel refreshKey={1} />);

    expect(await screen.findByText("新模型")).toBeInTheDocument();
    expect(screen.queryByText("旧模型")).not.toBeInTheDocument();
    expect(mocks.unit).toHaveBeenCalledTimes(2);
  });

  it("目录分页每页展示 10 条并支持翻页", async () => {
    const user = userEvent.setup();
    mocks.unit.mockResolvedValue({
      models: Array.from({ length: 12 }, (_, index) => ({
        slug: `ccs/model-${index + 1}`,
        display_name: `模型 ${index + 1}`,
      })),
      default_model: "ccs/model-1",
    });

    render(<AggregationSyncPanel />);

    expect(await screen.findByText("模型 1")).toBeInTheDocument();
    expect(screen.getByText("模型 10")).toBeInTheDocument();
    expect(screen.queryByText("模型 11")).not.toBeInTheDocument();
    expect(screen.getByText("第 1 / 2 页")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一页" }));

    expect(await screen.findByText("模型 11")).toBeInTheDocument();
    expect(screen.getByText("模型 12")).toBeInTheDocument();
    expect(screen.queryByText("模型 1")).not.toBeInTheDocument();
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
  });

  it("单条删除只更新 Codex 同步展示偏好", async () => {
    const user = userEvent.setup();
    const onPreferencesSaved = vi.fn();
    let preferences = {
      models: ["ccs/model-a", "ccs/model-b"],
      startupModel: "ccs/model-a",
      theme: "dark",
    };
    mocks.unit.mockImplementation(
      async (path: string, method = "GET", body?: unknown) => {
        if (path === "/catalog") {
          return {
            models: preferences.models.map((slug) => ({
              slug,
              display_name: slug === "ccs/model-a" ? "模型 A" : "模型 B",
            })),
            default_model: preferences.models[0],
          };
        }
        if (path === "/preferences" && method === "GET") {
          return { ...preferences, models: [...preferences.models] };
        }
        if (path === "/preferences" && method === "PUT") {
          preferences = body as typeof preferences;
          return body;
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<AggregationSyncPanel onPreferencesSaved={onPreferencesSaved} />);

    expect(await screen.findByText("模型 A")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "从 Codex 模型目录删除 模型 A",
      }),
    );

    await waitFor(() => {
      expect(mocks.unit).toHaveBeenCalledWith(
        "/preferences",
        "PUT",
        expect.objectContaining({
          models: ["ccs/model-b"],
          startupModel: "ccs/model-b",
          theme: "dark",
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("模型 A")).not.toBeInTheDocument();
    });
    expect(onPreferencesSaved).toHaveBeenCalledWith(
      expect.objectContaining({
        models: ["ccs/model-b"],
        startupModel: "ccs/model-b",
      }),
    );
  });

  it("清空同步模型并清理启动模型", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    let preferences = {
      models: ["ccs/model-a", "ccs/model-b"],
      startupModel: "ccs/model-a",
      theme: "dark",
    };
    mocks.unit.mockImplementation(
      async (path: string, method = "GET", body?: unknown) => {
        if (path === "/catalog") {
          return {
            models: preferences.models.map((slug) => ({
              slug,
              display_name: slug === "ccs/model-a" ? "模型 A" : "模型 B",
            })),
            default_model: preferences.models[0],
          };
        }
        if (path === "/preferences" && method === "GET") {
          return { ...preferences, models: [...preferences.models] };
        }
        if (path === "/preferences" && method === "PUT") {
          preferences = body as typeof preferences;
          return body;
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<AggregationSyncPanel />);

    expect(await screen.findByText("模型 A")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空同步模型" }));

    await waitFor(() => {
      expect(mocks.unit).toHaveBeenCalledWith(
        "/preferences",
        "PUT",
        expect.objectContaining({ models: [], theme: "dark" }),
      );
    });
    const put = mocks.unit.mock.calls.find(
      ([path, method]) => path === "/preferences" && method === "PUT",
    );
    expect(put?.[2]).not.toHaveProperty("startupModel");
    expect(await screen.findByText(/当前没有同步展示模型/)).toBeInTheDocument();
  });

  it("支持折叠和展开整个同步聚合模型面板", async () => {
    const user = userEvent.setup();
    mocks.unit.mockResolvedValue({
      models: [{ slug: "ccs/a", display_name: "模型 A" }],
    });

    render(<AggregationSyncPanel />);

    expect(await screen.findByText("1 个模型")).toBeInTheDocument();
    expect(screen.getByText("当前 Codex 模型目录")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "收起同步聚合模型" }));

    expect(screen.queryByText("当前 Codex 模型目录")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "展开同步聚合模型" }),
    ).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "展开同步聚合模型" }));

    expect(await screen.findByText("当前 Codex 模型目录")).toBeVisible();
  });
});
