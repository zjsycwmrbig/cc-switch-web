import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { TFunction } from "i18next";
import { useForm } from "react-hook-form";
import { Form } from "@/components/ui/form";
import type { ProviderCategory } from "@/types";
import {
  ProviderPresetSelector,
  filterPresetEntries,
  getPresetDisplayName,
  getPresetSearchText,
  getVisiblePresetEntries,
  sortPresetEntries,
} from "@/components/providers/forms/ProviderPresetSelector";

// Mock ProviderIcon 以避免依赖图标库的实际内容
vi.mock("@/components/ProviderIcon", () => ({
  ProviderIcon: ({
    icon,
    name,
    color,
    size,
  }: {
    icon?: string;
    name: string;
    color?: string;
    size?: number;
  }) => (
    <span
      data-testid="provider-icon"
      data-icon={icon}
      data-name={name}
      data-color={color}
      data-size={size}
    />
  ),
}));

const presetCategoryLabels = {
  official: "官方",
  cn_official: "国产官方",
  aggregator: "聚合服务",
  third_party: "第三方",
};

const translations: Record<string, string> = {
  "preset.alpha": "Alpha 本地名",
  "preset.gamma": "Gamma 本地名",
};

const t = ((key: string) => translations[key] ?? key) as TFunction;

it("finds Tu-zi by Chinese and compact aliases when the display language is English", () => {
  const entries = [
    {
      id: "tuzi",
      preset: {
        name: "Tu-zi",
        websiteUrl: "https://api.tu-zi.com",
        settingsConfig: {},
      },
    },
  ];
  for (const query of ["兔子", "兔子api", "tuzi"]) {
    expect(filterPresetEntries(entries, query, t)).toEqual(entries);
  }
});

type TestPresetEntry = {
  id: string;
  preset: {
    name: string;
    nameKey?: string;
    websiteUrl: string;
    settingsConfig: Record<string, never>;
    category: ProviderCategory;
    primePartner?: boolean;
    isPartner?: boolean;
  };
};

const presetEntries: TestPresetEntry[] = [
  {
    id: "gamma",
    preset: {
      name: "Gamma Raw",
      nameKey: "preset.gamma",
      websiteUrl: "https://gamma.example.com",
      settingsConfig: {},
      category: "aggregator",
    },
  },
  {
    id: "alpha",
    preset: {
      name: "Alpha Raw",
      nameKey: "preset.alpha",
      websiteUrl: "https://alpha.example.com/v1",
      settingsConfig: {},
      category: "official",
    },
  },
  {
    id: "beta",
    preset: {
      name: "Beta Gateway",
      websiteUrl: "https://CN-Gateway.example.com",
      settingsConfig: {},
      category: "cn_official",
    },
  },
  {
    id: "delta",
    preset: {
      name: "Delta Mirror",
      websiteUrl: "https://delta.example.com",
      settingsConfig: {},
      category: "third_party",
    },
  },
] satisfies TestPresetEntry[];

function getIds(entries: ReadonlyArray<{ id: string }>) {
  return entries.map((entry) => entry.id);
}

function renderSelector({
  entries = presetEntries,
  onPresetChange = vi.fn(),
}: {
  entries?: TestPresetEntry[];
  onPresetChange?: (value: string) => void;
} = {}) {
  const Wrapper = () => {
    const form = useForm();

    return (
      <Form {...form}>
        <ProviderPresetSelector
          selectedPresetId="custom"
          presetEntries={entries}
          presetCategoryLabels={presetCategoryLabels}
          onPresetChange={onPresetChange}
        />
      </Form>
    );
  };

  return render(<Wrapper />);
}

function getPresetButtonTexts() {
  const knownNames = new Set([
    "providerPreset.custom",
    ...presetEntries.flatMap((entry) => [
      entry.preset.name,
      entry.preset.nameKey ?? entry.preset.name,
    ]),
  ]);

  return screen
    .getAllByRole("button")
    .map((button) => button.textContent?.trim() ?? "")
    .filter((text) => knownNames.has(text));
}

function getSearchButton() {
  return screen.getByRole("button", {
    name: /providerPreset\.(search|searchAriaLabel|openSearch)|搜索|search/i,
  });
}

function getSearchInput() {
  return screen.getByRole("textbox", {
    name: /providerPreset\.(searchInput|searchPlaceholder)|搜索预设|search/i,
  });
}

describe("ProviderPresetSelector pure helpers", () => {
  it("优先使用 nameKey 翻译作为显示名，否则使用原始 name", () => {
    expect(getPresetDisplayName(presetEntries[1].preset, t)).toBe(
      "Alpha 本地名",
    );
    expect(getPresetDisplayName(presetEntries[2].preset, t)).toBe(
      "Beta Gateway",
    );
  });

  it("拼接名称与域名并统一 lower-case，不包含分类 label", () => {
    const searchText = getPresetSearchText(presetEntries[1], t);

    expect(searchText).toContain("alpha 本地名");
    expect(searchText).toContain("alpha raw");
    expect(searchText).toContain("example.com");
    expect(searchText).not.toContain("官方");
    expect(searchText).toBe(searchText.toLowerCase());
  });

  it("空 query 返回原数组，非空 query 大小写不敏感匹配", () => {
    expect(filterPresetEntries(presetEntries, "   ", t)).toBe(presetEntries);
    expect(
      getIds(filterPresetEntries(presetEntries, "ALPHA 本地名", t)),
    ).toEqual(["alpha"]);
  });

  it("支持 URL 搜索且不按分类标签匹配", () => {
    expect(
      getIds(filterPresetEntries(presetEntries, "cn-gateway.example.com", t)),
    ).toEqual(["beta"]);
    expect(getIds(filterPresetEntries(presetEntries, "聚合", t))).toEqual([]);
  });

  it("按翻译显示名 A–Z 排序，不修改输入；搜索结果保持相同顺序", () => {
    expect(getIds(sortPresetEntries(presetEntries, t))).toEqual([
      "alpha",
      "beta",
      "delta",
      "gamma",
    ]);
    expect(getIds(presetEntries)).toEqual(["gamma", "alpha", "beta", "delta"]);
    expect(
      getIds(getVisiblePresetEntries(presetEntries, { query: "a", t })),
    ).toEqual(["alpha", "beta", "delta", "gamma"]);
  });

  it("官方、合作及双重身份均不影响字母顺序", () => {
    const mixed: TestPresetEntry[] = [
      {
        id: "restZulu",
        preset: {
          name: "Zulu Rest",
          websiteUrl: "https://rest-zulu.example.com",
          settingsConfig: {},
          category: "third_party",
        },
      },
      {
        id: "partnerZeta",
        preset: {
          name: "Zeta Partner",
          websiteUrl: "https://partner-zeta.example.com",
          settingsConfig: {},
          category: "aggregator",
          isPartner: true,
        },
      },
      {
        id: "primeAndPartner",
        preset: {
          name: "Prime And Partner",
          websiteUrl: "https://prime-and-partner.example.com",
          settingsConfig: {},
          category: "cn_official",
          primePartner: true,
          isPartner: true,
        },
      },
      {
        id: "officialOnly",
        preset: {
          name: "Official Only",
          websiteUrl: "https://official-only.example.com",
          settingsConfig: {},
          category: "official",
        },
      },
      {
        id: "officialPrime",
        preset: {
          name: "Official Prime",
          websiteUrl: "https://official-prime.example.com",
          settingsConfig: {},
          category: "official",
          primePartner: true,
        },
      },
      {
        id: "partnerAlpha",
        preset: {
          name: "Alpha Partner",
          websiteUrl: "https://partner-alpha.example.com",
          settingsConfig: {},
          category: "third_party",
          isPartner: true,
        },
      },
      {
        id: "restAlpha",
        preset: {
          name: "Alpha Rest",
          websiteUrl: "https://rest-alpha.example.com",
          settingsConfig: {},
          category: "aggregator",
        },
      },
    ];

    expect(getIds(sortPresetEntries(mixed, t))).toEqual([
      "partnerAlpha",
      "restAlpha",
      "officialOnly",
      "officialPrime",
      "primeAndPartner",
      "partnerZeta",
      "restZulu",
    ]);
  });
});

describe("ProviderPresetSelector", () => {
  it("默认按显示名称 A–Z 排序，自定义入口单独保留", () => {
    renderSelector();
    expect(getPresetButtonTexts()).toEqual([
      "providerPreset.custom",
      "Beta Gateway",
      "Delta Mirror",
      "preset.alpha",
      "preset.gamma",
    ]);
  });

  it("合作预设无星标、心形、合作标签或原始顺序切换入口", () => {
    const entries: TestPresetEntry[] = [
      {
        id: "z",
        preset: {
          name: "Zulu",
          category: "official",
          isPartner: true,
          primePartner: true,
          websiteUrl: "https://example.com",
          settingsConfig: {},
        },
      },
      {
        id: "a",
        preset: {
          name: "alpha",
          category: "third_party",
          websiteUrl: "https://example.com",
          settingsConfig: {},
        },
      },
    ];
    const { container } = renderSelector({ entries });
    const buttons = screen
      .getAllByRole("button")
      .filter((button) => ["alpha", "Zulu"].includes(button.textContent ?? ""));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "alpha",
      "Zulu",
    ]);
    expect(buttons[0].className).toBe(buttons[1].className);
    expect(container.querySelector(".lucide-star, .lucide-heart")).toBeNull();
    expect(
      screen.queryByText(/providerPreset\.(partner|primePartner)/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /sort|排序|恢复原顺序/i }),
    ).not.toBeInTheDocument();
  });

  it("搜索只过滤普通 preset，自定义配置始终保留", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    expect(
      screen.getByRole("button", { name: "providerPreset.custom" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Beta Gateway" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.gamma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.alpha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delta Mirror" }),
    ).not.toBeInTheDocument();
  });

  it("搜索无普通 preset 结果时保留自定义配置并显示空状态", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "not-found");

    expect(
      screen.getByRole("button", { name: "providerPreset.custom" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.gamma" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "preset.alpha" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Beta Gateway" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Delta Mirror" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(
        /providerPreset\.(empty|noResults)|没有匹配|无结果|no matching presets/i,
      ),
    ).toBeInTheDocument();
  });

  it("所有预设按钮填满网格列宽(w-full)实现等宽对齐", () => {
    renderSelector();

    const presetButtons = screen.getAllByRole("button");
    const fullWidthButtons = presetButtons.filter((btn) =>
      btn.className.includes("w-full"),
    );

    // 至少包含 custom + 4 个预设 = 5 个等宽按钮(搜索/排序按钮为 size-8 不计入)
    expect(fullWidthButtons.length).toBeGreaterThanOrEqual(5);
  });

  it("preset.icon 存在时按钮内渲染图标元素(img/svg)", () => {
    const entriesWithIcon = [
      {
        id: "with-icon",
        preset: {
          name: "With Icon",
          websiteUrl: "https://icon.example.com",
          settingsConfig: {},
          category: "official" as ProviderCategory,
          icon: "claude-api",
          iconColor: "#D4915D",
        },
      },
    ];

    renderSelector({ entries: entriesWithIcon });

    const button = screen.getByRole("button", { name: /with icon/i });
    const icon = button.querySelector('[data-testid="provider-icon"]');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute("data-icon")).toBe("claude-api");
    expect(icon?.getAttribute("data-color")).toBe("#D4915D");
  });

  it("preset 无 icon 且无 theme.icon 时,按钮内仍渲染占位元素保持文字对齐", () => {
    const entriesWithoutIcon = [
      {
        id: "no-icon",
        preset: {
          name: "No Icon",
          websiteUrl: "https://noicon.example.com",
          settingsConfig: {},
          category: "official" as ProviderCategory,
        },
      },
    ];

    renderSelector({ entries: entriesWithoutIcon });

    const button = screen.getByRole("button", { name: /no icon/i });
    // 占位 span(16x16)应该存在,保证文字位置与有图标的按钮对齐
    const placeholder = button.querySelector("span[aria-hidden]");
    expect(placeholder).not.toBeNull();
  });

  it("custom 按钮同样渲染占位元素,文字与带图标的预设按钮对齐", () => {
    renderSelector();

    const customButton = screen.getByRole("button", {
      name: "providerPreset.custom",
    });
    const placeholder = customButton.querySelector("span[aria-hidden]");
    expect(placeholder).not.toBeNull();
  });

  it("点击放大镜 inline 切换搜索输入框可见性,ESC 收起并清空", async () => {
    const user = userEvent.setup();
    renderSelector();

    // 初始没有搜索输入框
    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|搜索预设|search/i,
      }),
    ).not.toBeInTheDocument();

    // 点击放大镜展开输入框
    await user.click(getSearchButton());
    const input = getSearchInput();
    expect(input).toBeInTheDocument();

    // 输入关键字过滤
    await user.type(input, "gateway");
    expect(
      screen.getByRole("button", { name: "Beta Gateway" }),
    ).toBeInTheDocument();

    // ESC 收起输入框并清空
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|搜索预设|search/i,
      }),
    ).not.toBeInTheDocument();
    // 收起后所有预设恢复显示
    expect(
      screen.getByRole("button", { name: "preset.gamma" }),
    ).toBeInTheDocument();
  });

  it("按 Ctrl+F 快捷键打开搜索输入框", async () => {
    const user = userEvent.setup();
    renderSelector();

    // 初始没有搜索输入框
    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|搜索预设|search/i,
      }),
    ).not.toBeInTheDocument();

    // 按 Ctrl+F 展开输入框
    await user.keyboard("{Control>}f{/Control}");
    expect(getSearchInput()).toBeInTheDocument();
  });

  it("搜索后点击预设按钮可选中预设且不清空搜索关键词", async () => {
    const user = userEvent.setup();
    const onPresetChange = vi.fn();
    renderSelector({ onPresetChange });

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    await user.click(screen.getByRole("button", { name: "Beta Gateway" }));

    expect(onPresetChange).toHaveBeenCalledWith("beta");
    // 搜索框仍展开、关键词保留
    expect(getSearchInput()).toBeInTheDocument();
    expect(getSearchInput()).toHaveValue("gateway");
  });

  it("搜索已打开、焦点在别处时再次 Ctrl+F 把焦点移回搜索框且保留关键词", async () => {
    const user = userEvent.setup();
    renderSelector();

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");

    // 选中 preset 后焦点离开搜索框（搜索框仍展开、关键词保留）
    await user.click(screen.getByRole("button", { name: "Beta Gateway" }));
    expect(getSearchInput()).not.toHaveFocus();

    // 再次 Ctrl+F：setSearchOpen(true) 同值不重渲染、autoFocus 不重触发，
    // 需靠快捷键命中时的命令式聚焦把焦点移回搜索框，且不清空关键词
    await user.keyboard("{Control>}f{/Control}");
    await waitFor(() => expect(getSearchInput()).toHaveFocus());
    expect(getSearchInput()).toHaveValue("gateway");
  });

  it("点击组件外区域自动收起并清空", async () => {
    const user = userEvent.setup();
    const Wrapper = () => {
      const form = useForm();
      return (
        <Form {...form}>
          <ProviderPresetSelector
            selectedPresetId="custom"
            presetEntries={presetEntries}
            presetCategoryLabels={presetCategoryLabels}
            onPresetChange={vi.fn()}
          />
          <div data-testid="outside">Outside</div>
        </Form>
      );
    };
    render(<Wrapper />);

    await user.click(getSearchButton());
    await user.type(getSearchInput(), "gateway");
    expect(getSearchInput()).toBeInTheDocument();

    // 点击组件外的元素应收起搜索框
    await user.click(screen.getByTestId("outside"));

    expect(
      screen.queryByRole("textbox", {
        name: /providerPreset\.(searchInput|searchPlaceholder)|搜索预设|search/i,
      }),
    ).not.toBeInTheDocument();
    // 收起后清空 query,所有预设恢复显示
    expect(
      screen.getByRole("button", { name: "preset.gamma" }),
    ).toBeInTheDocument();
  });
});
