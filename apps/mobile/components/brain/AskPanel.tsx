import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Keyboard } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { ask, SAMPLE_QUESTIONS, type AskAnswer } from '@/lib/brain/ask';
import type { BrainData } from '@/lib/brain/useBrainData';
import { hLight, hSelect } from '@/lib/haptics';
import { Card, Muted, Faint, ListRow, useBrainStyles } from './ui';

// 💬 Ask — type a money question, get an answer computed from your own data.

export interface AskTurn { id: number; question: string; answer: AskAnswer }

export default function AskPanel({ data, thread, setThread }: {
  data: BrainData;
  thread: AskTurn[];
  setThread: (fn: (prev: AskTurn[]) => AskTurn[]) => void;
}) {
  const { c, s } = useBrainStyles();
  const router = useRouter();
  const [q, setQ] = useState('');

  function submit(question: string) {
    const text = question.trim();
    if (!text) return;
    hLight();
    Keyboard.dismiss();
    const answer = ask(text, { ...data.askContext, now: new Date() });
    setThread(prev => [{ id: Date.now(), question: text, answer }, ...prev].slice(0, 20));
    setQ('');
  }

  return (
    <View style={{ gap: 12 }}>
      <View style={[styles.inputRow, { backgroundColor: c.inputBg, borderColor: c.inputBorder }]}>
        <TextInput
          style={[styles.input, { color: c.text }]}
          value={q}
          onChangeText={setQ}
          placeholder="Ask about your money…"
          placeholderTextColor={c.textFaint}
          returnKeyType="send"
          onSubmitEditing={() => submit(q)}
          autoCorrect={false}
        />
        <TouchableOpacity
          onPress={() => submit(q)}
          disabled={!q.trim()}
          style={[styles.send, { backgroundColor: q.trim() ? c.primary : c.track }]}
          activeOpacity={0.85}
        >
          <Text style={[styles.sendText, { color: c.onColor }]}>Ask</Text>
        </TouchableOpacity>
      </View>

      {thread.length === 0 && (
        <Card title="Try asking">
          <View style={styles.chips}>
            {SAMPLE_QUESTIONS.map(sq => (
              <TouchableOpacity key={sq} onPress={() => { hSelect(); submit(sq); }} activeOpacity={0.8} style={[styles.chip, { backgroundColor: c.chipBg, borderColor: c.chipBorder }]}>
                <Text style={[styles.chipText, { color: c.text }]}>{sq}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Faint>Answers come from your own transactions, budgets, loans and Safety Net, worked out on your phone. Nothing is sent to an AI.</Faint>
        </Card>
      )}

      {thread.map(turn => (
        <View key={turn.id} style={{ gap: 6 }}>
          <View style={[styles.qBubble, { backgroundColor: c.primary }]}>
            <Text style={[styles.qText, { color: c.onColor }]}>{turn.question}</Text>
          </View>
          <Card>
            <Text style={[styles.aTitle, { color: c.text }]}>{turn.answer.title}</Text>
            {turn.answer.lines.map((l, i) => <Muted key={i}>{l}</Muted>)}
            {turn.answer.items && turn.answer.items.length > 0 && (
              <View style={{ gap: 2 }}>
                {turn.answer.items.map((it, i) => <ListRow key={i} label={it.label} value={it.value} />)}
              </View>
            )}
            {turn.answer.action && (
              <TouchableOpacity onPress={() => router.push(turn.answer.action!.route as Href)} activeOpacity={0.7}>
                <Text style={s.link}>{turn.answer.action.label} →</Text>
              </TouchableOpacity>
            )}
            {turn.answer.suggestions && (
              <View style={styles.chips}>
                {turn.answer.suggestions.map(sq => (
                  <TouchableOpacity key={sq} onPress={() => submit(sq)} activeOpacity={0.8} style={[styles.chip, { backgroundColor: c.chipBg, borderColor: c.chipBorder }]}>
                    <Text style={[styles.chipText, { color: c.text }]}>{sq}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </Card>
        </View>
      ))}

      {thread.length > 0 && (
        <TouchableOpacity onPress={() => { hSelect(); setThread(() => []); }} style={styles.clear} activeOpacity={0.7}>
          <Text style={[styles.clearText, { color: c.textFaint }]}>Clear conversation</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: 14, paddingLeft: 14, paddingRight: 6, paddingVertical: 6 },
  input: { flex: 1, fontSize: 15, paddingVertical: 6 },
  send: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 9 },
  sendText: { fontSize: 14, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderRadius: 99, paddingHorizontal: 12, paddingVertical: 7 },
  chipText: { fontSize: 12.5, fontWeight: '600' },
  qBubble: { alignSelf: 'flex-end', borderRadius: 14, borderBottomRightRadius: 4, paddingHorizontal: 14, paddingVertical: 9, maxWidth: '85%' },
  qText: { fontSize: 14, fontWeight: '600' },
  aTitle: { fontSize: 15, fontWeight: '800', lineHeight: 21 },
  clear: { alignSelf: 'center', paddingVertical: 6 },
  clearText: { fontSize: 12.5, fontWeight: '600' },
});
