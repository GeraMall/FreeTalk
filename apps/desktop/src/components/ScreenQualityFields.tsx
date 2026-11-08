import { ChoicePicker } from './BirthDatePicker';
import { t } from '../lib/app-language';
import type { ScreenQuality } from '../lib/video-quality';
import './screen-quality.css';

export function ScreenQualityFields({
  value,
  onChange,
  compact = false,
}: {
  value: ScreenQuality;
  onChange(patch: Partial<ScreenQuality>): void;
  compact?: boolean;
}) {
  return (
    <div className={`video-quality-grid screen-quality-fields${compact ? ' is-compact' : ''}`}>
      <div className="field-label">
        <span>{t('Тип содержимого')}</span>
        <ChoicePicker
          className="screen-quality-select"
          label={t('Тип содержимого')}
          value={value.screenContentMode}
          options={[
            { value: 'text', label: t('Текст · максимальная чёткость') },
            { value: 'balanced', label: t('Универсальный · чётко и плавно') },
            { value: 'video', label: t('Видео · плавное движение') },
          ]}
          onChange={(screenContentMode) =>
            onChange({ screenContentMode: screenContentMode as ScreenQuality['screenContentMode'] })
          }
        />
        {!compact && (
          <small>
            {t('«Текст» бережёт детали, универсальный режим балансирует их с движением.')}
          </small>
        )}
      </div>
      <div className="field-label">
        <span>{t('Максимальное разрешение')}</span>
        <ChoicePicker
          className="screen-quality-select"
          label={t('Максимальное разрешение')}
          value={value.screenResolution}
          options={[
            { value: '720p', label: 'HD · 1280×720' },
            { value: '1080p', label: 'Full HD · 1920×1080' },
            { value: '1440p', label: '2K · 2560×1440' },
          ]}
          onChange={(screenResolution) =>
            onChange({ screenResolution: screenResolution as ScreenQuality['screenResolution'] })
          }
        />
        {!compact && (
          <small>{t('Задаёт верхнюю границу детализации передаваемого изображения.')}</small>
        )}
      </div>
      <div className="field-label">
        <span>{t('Частота кадров')}</span>
        <ChoicePicker
          className="screen-quality-select"
          label={t('Частота кадров')}
          value={String(value.screenFrameRate)}
          options={[
            { value: '15', label: t('15 FPS · экономно') },
            { value: '30', label: t('30 FPS · рекомендуется') },
            { value: '60', label: t('60 FPS · плавно') },
          ]}
          onChange={(screenFrameRate) =>
            onChange({
              screenFrameRate: Number(screenFrameRate) as ScreenQuality['screenFrameRate'],
            })
          }
        />
        {!compact && (
          <small>{t('Определяет плавность движения при достаточной скорости сети.')}</small>
        )}
      </div>
    </div>
  );
}
