import { describe, it, expect } from 'vitest';
import { analyzeReportQuality } from './analysisQuality';

describe('analyzeReportQuality', () => {
  it('treats null/empty as ok', () => {
    expect(analyzeReportQuality(null)).toEqual({ level: 'ok', coverage: null });
    expect(analyzeReportQuality('')).toEqual({ level: 'ok', coverage: null });
  });

  it('treats a clean 100% report as ok (and ignores the ЗВІТ КОНТРОЛЮ ЯКОСТІ header)', () => {
    const report =
      '# Аналіз\n...body...\n\n📋 **ЗВІТ КОНТРОЛЮ ЯКОСТІ:**\n' +
      '• **Покриття даних:** 100%\n• **Повнота обробки:** Підтверджено\n' +
      '### 🎯 Висновок\n✅ Отличное качество! Все дела обработаны корректно.';
    expect(analyzeReportQuality(report)).toEqual({ level: 'ok', coverage: 100 });
  });

  it('flags partial when a batch was skipped', () => {
    const report = 'тіло\n⚠️ Частина справ не була проаналізована через тимчасову помилку AI.';
    expect(analyzeReportQuality(report).level).toBe('partial');
  });

  it('flags partial when QC reports problems', () => {
    const report = '...\n• **Повнота обробки:** Виявлені проблеми\n### ⚠️ Виявлені проблеми\n• ...';
    expect(analyzeReportQuality(report).level).toBe('partial');
  });

  it('flags partial and parses coverage when below 100%', () => {
    const report = '...\n• **Покриття даних:** 78%\n...';
    expect(analyzeReportQuality(report)).toEqual({ level: 'partial', coverage: 78 });
  });
});
