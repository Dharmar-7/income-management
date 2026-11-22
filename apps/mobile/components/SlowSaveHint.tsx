import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useTheme } from '@/context/ThemeContext';

// Shown under a Save button when saving takes more than a few seconds. The API
// sleeps on Render's free tier and needs 30-50 s to wake, so the first save
// after a quiet spell is slow; this tells the user the app hasn't frozen.
// Render it only while saving: `{saving && <SlowSaveHint />}`.
export default function SlowSaveHint({ after = 4000 }: { after?: number }) {
  const { theme: c } = useTheme();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), after);
    return () => clearTimeout(t);
  }, [after]);
  if (!slow) return null;
  return (
    <Text style={{ color: c.textMuted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>
      Waking up the server… the first save after a while can take up to a minute.
    </Text>
  );
}
