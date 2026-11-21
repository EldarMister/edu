import { View } from '@/components/themed';
import { Button } from '@/components/ui';
import { accessForUser, type Workspace } from '@/lib/workspaces';
import { useAuth } from '@/store/auth';
import { spacing } from '@/theme';

export function WorkspaceSwitcher({ beforeSwitch }: { beforeSwitch?: (next: () => void) => void }) {
  const user = useAuth((state) => state.user);
  const current = useAuth((state) => state.workspace);
  const select = useAuth((state) => state.setWorkspace);
  if (!user) return null;
  const access = accessForUser(user);
  const choices: { key: Workspace; label: string }[] = [
    { key: 'admin', label: 'Открыть админ-панель' },
    { key: 'terminal', label: 'Открыть кассу' },
    { key: 'production', label: access.production === 'bar' ? 'Открыть бар' : 'Открыть кухню' },
  ];
  const available = choices.filter((choice) => choice.key !== current && access[choice.key]);
  if (!available.length) return null;
  return (
    <View style={{ gap: spacing.sm }}>
      {available.map(({ key, label }) => (
        <Button key={key} title={label} variant="secondary" size="md" onPress={() => {
          if (beforeSwitch) beforeSwitch(() => select(key));
          else select(key);
        }} />
      ))}
    </View>
  );
}
