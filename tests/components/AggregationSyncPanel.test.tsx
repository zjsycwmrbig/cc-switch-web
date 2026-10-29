import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AggregationSyncPanel } from "@/components/providers/AggregationSyncPanel";

const mocks = vi.hoisted(() => ({
  unit: vi.fn(),
  session: {
    current: { me: { user: { id: "user-1" } } } as unknown,
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

const emptyCatalog = { models: [] };
const mockCatalog = (catalog: unknown) => {
  mocks.unit.mockImplementation(async (path: string) => {
    if (path === "/keys") return [];
    if (path === "/catalog") return catalog;
    throw new Error(`unexpected request: GET ${path}`);
  });
};
const device = (id: string, name: string, createdAt = 1, tokenVersion = 1) => ({
  id,
  name,
  prefix: `ccu_${id}`,
  active: 1,
  token_version: tokenVersion,
  created_at: createdAt,
});

describe("AggregationSyncPanel model catalog", () => {
  beforeEach(() => {
    Object.defineProperties(HTMLElement.prototype, {
      hasPointerCapture: {
        configurable: true,
        value: () => false,
      },
      setPointerCapture: {
        configurable: true,
        value: () => undefined,
      },
      releasePointerCapture: {
        configurable: true,
        value: () => undefined,
      },
      scrollIntoView: {
        configurable: true,
        value: () => undefined,
      },
    });
    mocks.unit.mockReset();
    localStorage.clear();
    mocks.session.current = { me: { user: { id: "user-1" } } };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("展示当前 Codex 目录中的模型名称和 slug", async () => {
    mockCatalog({
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
    let catalogRequest = 0;
    mocks.unit.mockImplementation(async (path: string) => {
      if (path === "/keys") return [];
      if (path === "/catalog") {
        catalogRequest += 1;
        return catalogRequest === 1
          ? { models: [{ slug: "ccs-a/old", display_name: "旧模型" }] }
          : { models: [{ slug: "ccs-a/new", display_name: "新模型" }] };
      }
      throw new Error(`unexpected request: GET ${path}`);
    });

    const view = render(<AggregationSyncPanel refreshKey={0} />);
    expect(await screen.findByText("旧模型")).toBeInTheDocument();

    view.rerender(<AggregationSyncPanel refreshKey={1} />);

    expect(await screen.findByText("新模型")).toBeInTheDocument();
    expect(screen.queryByText("旧模型")).not.toBeInTheDocument();
    expect(
      mocks.unit.mock.calls.filter(([path]) => path === "/catalog"),
    ).toHaveLength(2);
  });

  it("目录分页每页展示 10 条并支持翻页", async () => {
    const user = userEvent.setup();
    mockCatalog({
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
        if (path === "/keys") return [];
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
        if (path === "/keys") return [];
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
    mockCatalog({
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

  it("已有设备码时默认选择最新设备", async () => {
    localStorage.setItem("ccswitchuint-last-device:user-1", "device-1");
    mocks.unit.mockImplementation(async (path: string) => {
      if (path === "/catalog") return emptyCatalog;
      if (path === "/keys") {
        return [
          device("device-1", "较早设备", 1),
          device("device-3", "最新设备", 3),
          device("device-2", "中间设备", 2),
        ];
      }
      if (path === "/keys/device-3/command") {
        return { command: "command-for-latest-device" };
      }
      throw new Error(`unexpected request: GET ${path}`);
    });

    render(<AggregationSyncPanel />);

    expect(await screen.findByText("command-for-latest-device")).toBeVisible();
    expect(mocks.unit).not.toHaveBeenCalledWith("/keys/device-1/command");
    expect(mocks.unit).not.toHaveBeenCalledWith("/keys/device-2/command");
    expect(localStorage.getItem("ccswitchuint-last-device:user-1")).toBe(
      "device-1",
    );
  });

  it("没有可用设备时首次复制才创建 default", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mocks.unit.mockImplementation(
      async (path: string, method = "GET", body?: unknown) => {
        if (path === "/catalog") return emptyCatalog;
        if (path === "/keys" && method === "GET") return [];
        if (path === "/keys" && method === "POST") {
          expect(body).toEqual({ name: "default", expiresAt: null });
          return {
            ...device("created", "default"),
            command: "created-default-command",
          };
        }
        if (path === "/keys/created/command") {
          return { command: "created-default-command" };
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<AggregationSyncPanel />);

    await user.click(
      await screen.findByRole("button", { name: "创建 default 并复制" }),
    );
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("created-default-command");
    });
    expect(
      mocks.unit.mock.calls.filter(
        ([path, method]) => path === "/keys" && method === "POST",
      ),
    ).toHaveLength(1);
    expect(localStorage.getItem("ccswitchuint-last-device:user-1")).toBeNull();
  });

  it("快速重复点击首次复制只创建一个 default 设备", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    let releaseCreate: (value: unknown) => void = () => undefined;
    const createResponse = new Promise((resolve) => {
      releaseCreate = resolve;
    });
    mocks.unit.mockImplementation(
      async (path: string, method = "GET", body?: unknown) => {
        if (path === "/catalog") return emptyCatalog;
        if (path === "/keys" && method === "GET") return [];
        if (path === "/keys" && method === "POST") {
          expect(body).toEqual({ name: "default", expiresAt: null });
          return createResponse;
        }
        if (path === "/keys/created/command") {
          return { command: "created-default-command" };
        }
        throw new Error(`unexpected request: ${method} ${path}`);
      },
    );

    render(<AggregationSyncPanel />);
    const button = await screen.findByRole("button", {
      name: "创建 default 并复制",
    });
    fireEvent.click(button);
    fireEvent.click(button);
    releaseCreate({
      ...device("created", "default"),
      command: "created-default-command",
    });

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("created-default-command");
    });
    expect(
      mocks.unit.mock.calls.filter(
        ([path, method]) => path === "/keys" && method === "POST",
      ),
    ).toHaveLength(1);
  });

  it("历史设备码与当前设备码统一展示，手动切换后读取对应命令", async () => {
    const user = userEvent.setup();
    mocks.unit.mockImplementation(async (path: string) => {
      if (path === "/catalog") return emptyCatalog;
      if (path === "/keys") {
        return [
          device("legacy", "历史设备", 3, 0),
          device("current", "当前设备", 2, 1),
        ];
      }
      if (path === "/keys/current/command") {
        return { command: "command-for-current-device" };
      }
      throw new Error(`unexpected request: GET ${path}`);
    });

    render(<AggregationSyncPanel />);

    expect(await screen.findByText(/这台设备码沿用历史凭据/)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "无法生成同步命令" }),
    ).toBeDisabled();
    expect(mocks.unit).not.toHaveBeenCalledWith("/keys/legacy/command");

    await user.click(
      await screen.findByRole("combobox", { name: "选择同步设备" }),
    );
    expect(
      await screen.findByRole("option", { name: /历史设备/ }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: /当前设备/ }));

    expect(await screen.findByText("command-for-current-device")).toBeVisible();
    expect(
      screen.queryByText(/这台设备码沿用历史凭据/),
    ).not.toBeInTheDocument();
    expect(localStorage.getItem("ccswitchuint-last-device:user-1")).toBeNull();
  });
});
