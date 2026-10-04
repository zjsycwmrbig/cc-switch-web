import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, it, expect } from "vitest";
import {
  ClaudeAggregationModels,
  normalizeAggregationModels,
} from "@/components/providers/forms/ClaudeAggregationModels";
import type { ClaudeStackModel } from "@/types";

describe("Claude 聚合模型", () => {
  it("批选远端模型保留默认项和自定义名称，不重复加入已有模型", () => {
    function Form() {
      const [value, setValue] = useState<ClaudeStackModel[] | undefined>([
        { model: "a", displayName: "Custom" },
      ]);
      return (
        <>
          <ClaudeAggregationModels
            value={value}
            onChange={setValue}
            fetchedModels={[
              { id: "a", ownedBy: null },
              { id: "b", ownedBy: null },
            ]}
          />
          <output data-testid="value">{JSON.stringify(value)}</output>
        </>
      );
    }
    render(<Form />);
    expect(screen.getByRole("checkbox", { name: "a" })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "b" }));
    fireEvent.click(screen.getByRole("button", { name: "Add selected (1)" }));
    expect(screen.getByTestId("value")).toHaveTextContent(
      '[{"model":"a","displayName":"Custom"},{"model":"b"}]',
    );
  });
  it("保留默认顺序，合并同名模型的 1M 和显示名称，丢弃空行", () => {
    expect(
      normalizeAggregationModels([
        { model: " b " },
        { model: "a[1M]" },
        { model: "a", displayName: " Alpha " },
        { model: "b", oneM: true },
        { model: " " },
      ]),
    ).toEqual([
      { model: "b", oneM: true },
      { model: "a", oneM: true, displayName: "Alpha" },
    ]);
  });
  it("区分沿用映射与显式空列表，并允许把所选模型移到默认位置", () => {
    function Form() {
      const [value, setValue] = useState<ClaudeStackModel[] | undefined>([
        { model: "b" },
        { model: "a" },
      ]);
      return (
        <>
          <ClaudeAggregationModels value={value} onChange={setValue} />
          <output data-testid="value">
            {JSON.stringify(value) ?? "fallback"}
          </output>
        </>
      );
    }
    render(<Form />);
    fireEvent.click(
      screen.getAllByRole("button", { name: "webMode.models.first" })[1],
    );
    expect(screen.getByTestId("value")).toHaveTextContent(
      '[{"model":"a"},{"model":"b"}]',
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "common.delete" })[0],
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "common.delete" })[0],
    );
    expect(screen.getByTestId("value")).toHaveTextContent("[]");
    fireEvent.click(
      screen.getByRole("checkbox", { name: "webMode.models.custom" }),
    );
    expect(screen.getByTestId("value")).toHaveTextContent("fallback");
  });
});
