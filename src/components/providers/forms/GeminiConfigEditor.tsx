import React, { useState } from "react";
import { GeminiEnvSection, GeminiConfigSection } from "./GeminiConfigSections";
import { GeminiCommonConfigModal } from "./GeminiCommonConfigModal";

interface GeminiConfigEditorProps {
  keyFieldMode?: boolean;
  envValue: string;
  configValue: string;
  onEnvChange: (value: string) => void;
  onConfigChange: (value: string) => void;
  onEnvBlur?: () => void;
  useCommonConfig: boolean;
  onCommonConfigToggle: (checked: boolean) => void;
  commonConfigSnippet: string;
  onCommonConfigSnippetChange: (value: string) => boolean;
  onCommonConfigErrorClear: () => void;
  commonConfigError: string;
  envError: string;
  configError: string;
  onExtract?: () => void;
  isExtracting?: boolean;
}

const GeminiConfigEditor: React.FC<GeminiConfigEditorProps> = ({
  keyFieldMode = false,
  envValue,
  configValue,
  onEnvChange,
  onConfigChange,
  onEnvBlur,
  useCommonConfig,
  onCommonConfigToggle,
  commonConfigSnippet,
  onCommonConfigSnippetChange,
  onCommonConfigErrorClear,
  commonConfigError,
  envError,
  configError,
  onExtract,
  isExtracting,
}) => {
  const [isCommonConfigModalOpen, setIsCommonConfigModalOpen] = useState(false);

  const handleCloseCommonConfigModal = () => {
    onCommonConfigErrorClear();
    setIsCommonConfigModalOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Env Section */}
      <GeminiEnvSection
        keyFieldMode={keyFieldMode}
        value={envValue}
        onChange={onEnvChange}
        onBlur={onEnvBlur}
        error={envError}
        useCommonConfig={useCommonConfig}
        onCommonConfigToggle={onCommonConfigToggle}
        onEditCommonConfig={() => setIsCommonConfigModalOpen(true)}
        commonConfigError={commonConfigError}
      />

      {/* Config JSON Section */}
      <GeminiConfigSection
        value={configValue}
        onChange={onConfigChange}
        configError={configError}
      />

      {/* Common Config Modal */}
      {!keyFieldMode && (
        <GeminiCommonConfigModal
          isOpen={isCommonConfigModalOpen}
          onClose={handleCloseCommonConfigModal}
          value={commonConfigSnippet}
          onSave={onCommonConfigSnippetChange}
          error={commonConfigError}
          onExtract={onExtract}
          isExtracting={isExtracting}
        />
      )}
    </div>
  );
};

export default GeminiConfigEditor;
