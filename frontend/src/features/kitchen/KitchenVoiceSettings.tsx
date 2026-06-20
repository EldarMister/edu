import { useEffect, useRef, useState } from 'react';
import { Toggle } from '@/components/Toggle';
import { kitchenVoice } from '@/services/kitchenVoice';
import {
  KITCHEN_SPEAKERS,
  KITCHEN_SPEECH_RATES,
  getKitchenVoiceSettings,
  saveKitchenVoiceSettings,
  subscribeKitchenVoiceSettings,
  type KitchenVoiceSettings as KitchenVoiceSettingsType,
} from '@/services/kitchenVoiceSettings';
import { KITCHEN_VOICE_TEST_SCENARIOS } from '@/services/kitchenVoiceScenarios';

export function KitchenVoiceSettings() {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<KitchenVoiceSettingsType>(() => getKitchenVoiceSettings());
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => subscribeKitchenVoiceSettings(setSettings), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function patch(next: Partial<KitchenVoiceSettingsType>) {
    setSettings(saveKitchenVoiceSettings(next));
    setTestMessage('');
  }

  async function testVoice() {
    setTesting(true);
    setTestMessage('');
    const scenario = KITCHEN_VOICE_TEST_SCENARIOS[
      Math.floor(Math.random() * KITCHEN_VOICE_TEST_SCENARIOS.length)
    ];
    try {
      await kitchenVoice.testScenario(scenario, settings);
      setTestMessage('Тест озвучки завершён');
    } catch (err) {
      console.error('[kitchen-tts] тест озвучки не удался:', err);
      setTestMessage('Не удалось воспроизвести тест');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex shrink-0 items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition-colors ${
          open
            ? 'border-primary bg-primary/5 text-primary'
            : 'border-primary bg-white text-primary hover:bg-primary/5'
        }`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <SpeakerIcon />
        Озвучка
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Настройки озвучки кухни"
          className="absolute right-0 top-[calc(100%+10px)] z-50 w-[calc(100vw-2rem)] max-w-[320px] rounded-xl border border-border bg-white p-4 text-sm shadow-soft"
        >
          <h3 className="text-[15px] font-semibold text-text-secondary">Настройки озвучки кухни</h3>

          <Section>
            <p className="mb-3 font-semibold text-text-primary">Голос</p>
            <div className="space-y-1.5">
              {KITCHEN_SPEAKERS.map((speaker) => (
                <button
                  key={speaker.value}
                  type="button"
                  onClick={() => patch({ speaker: speaker.value })}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors ${
                    settings.speaker === speaker.value
                      ? 'bg-primary/10 text-primary'
                      : 'text-text-secondary hover:bg-background'
                  }`}
                >
                  <Radio checked={settings.speaker === speaker.value} />
                  <span className="font-medium">{speaker.label}</span>
                </button>
              ))}
            </div>
          </Section>

          <Section>
            <SettingRow
              label="Уведомления"
              checked={settings.notificationsEnabled}
              onChange={(value) => patch({ notificationsEnabled: value })}
            />
            <SettingRow
              label="Голосовая озвучка"
              checked={settings.voiceEnabled}
              onChange={(value) => patch({ voiceEnabled: value })}
            />
          </Section>

          <Section>
            <p className="mb-3 font-semibold text-text-primary">Скорость озвучки</p>
            <div className="grid grid-cols-4 gap-1.5">
              {KITCHEN_SPEECH_RATES.map((rate) => (
                <button
                  key={rate}
                  type="button"
                  onClick={() => patch({ speechRate: rate })}
                  className={`rounded-lg border px-2 py-2 text-xs font-semibold transition-colors ${
                    settings.speechRate === rate
                      ? 'border-primary bg-primary text-white'
                      : 'border-border bg-white text-text-secondary hover:border-primary/40 hover:text-primary'
                  }`}
                >
                  {rate.toFixed(1)}x
                </button>
              ))}
            </div>
          </Section>

          <Section>
            <button
              type="button"
              onClick={testVoice}
              disabled={testing}
              className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {testing ? 'Тестируем...' : 'Тестировать'}
            </button>
            {testMessage && (
              <p className={`mt-2 text-xs ${testMessage.includes('Не удалось') ? 'text-danger' : 'text-success'}`}>
                {testMessage}
              </p>
            )}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <div className="mt-4 border-t border-border pt-4">{children}</div>;
}

function SettingRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="font-medium text-text-primary">{label}</span>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

function Radio({ checked }: { checked: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
        checked ? 'border-primary' : 'border-slate-300'
      }`}
    >
      {checked && <span className="h-2.5 w-2.5 rounded-full bg-primary" />}
    </span>
  );
}

function SpeakerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 5.5a9 9 0 0 1 0 13" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`transition-transform ${open ? 'rotate-180' : ''}`}
      aria-hidden
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
