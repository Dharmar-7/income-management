import { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, TouchableOpacity, ScrollView,
  ActivityIndicator, Image, StyleSheet,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { useAuth } from '@clerk/clerk-expo';
import { apiFetch } from '@/lib/api';
import { useKeyboardHeight } from '@/hooks/useKeyboardHeight';
import AppAlert from '@/components/AppAlert';
import DatePickerField from '@/components/DatePickerField';
import { useTheme } from '@/context/ThemeContext';
import type { Theme } from '@/lib/theme';

const CATEGORIES = ['Insurance', 'ID', 'Vehicle', 'Warranty', 'Receipt', 'Other'];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

interface Picked {
  base64: string;
  mimeType: string;
  uri: string;
}

export default function AddDocumentSheet({ visible, onClose, onSuccess }: Props) {
  const { getToken } = useAuth();
  const { theme: c } = useTheme();
  const styles = useMemo(() => makeStyles(c), [c]);
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();

  const [picked, setPicked] = useState<Picked | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('Other');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [alertInfo, setAlertInfo] = useState<{ title: string; message: string } | null>(null);

  function reset() {
    setPicked(null); setName(''); setCategory('Other'); setExpiresAt(''); setNote('');
  }
  function handleClose() { reset(); onClose(); }

  function takeAsset(a: ImagePicker.ImagePickerAsset | undefined) {
    if (!a?.base64) return;
    setPicked({ base64: a.base64, mimeType: a.mimeType ?? 'image/jpeg', uri: a.uri });
    if (!name) {
      const guess = `${category} ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`;
      setName(guess);
    }
  }

  async function pickGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { setAlertInfo({ title: 'Permission needed', message: 'Allow photo access to attach a document.' }); return; }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.6 });
    if (!res.canceled) takeAsset(res.assets[0]);
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { setAlertInfo({ title: 'Permission needed', message: 'Allow camera access to snap a document.' }); return; }
    const res = await ImagePicker.launchCameraAsync({ base64: true, quality: 0.6 });
    if (!res.canceled) takeAsset(res.assets[0]);
  }

  // Pick any file (PDF or image) from the phone's file manager / Downloads.
  async function pickFile() {
    const res = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/*'],
      copyToCacheDirectory: true,
    });
    if (res.canceled) return;
    const file = res.assets[0];
    if (!file) return;
    if (file.size && file.size > 5 * 1024 * 1024) {
      setAlertInfo({ title: 'File too large', message: 'Maximum size is 5 MB. Try a compressed PDF or a photo instead.' });
      return;
    }
    const base64 = await FileSystem.readAsStringAsync(file.uri, { encoding: FileSystem.EncodingType.Base64 });
    setPicked({ base64, mimeType: file.mimeType ?? 'application/pdf', uri: file.uri });
    // Prefer the real filename over the generated guess.
    if (!name && file.name) setName(file.name.replace(/\.[^.]+$/, ''));
  }

  async function handleSubmit() {
    if (!picked) { setAlertInfo({ title: 'No file', message: 'Take a photo, choose an image, or attach a file first.' }); return; }
    if (!name.trim()) { setAlertInfo({ title: 'Missing name', message: 'Give the document a name.' }); return; }
    setLoading(true);
    try {
      const token = await getToken();
      await apiFetch('/documents', token!, {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          category,
          dataBase64: picked.base64,
          mimeType: picked.mimeType,
          note: note.trim() || undefined,
          expiresAt: expiresAt || undefined,
        }),
      });
      reset();
      onSuccess();
      onClose();
    } catch (err: any) {
      setAlertInfo({ title: 'Upload failed', message: err.message ?? 'Please try again (max 5 MB).' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
        <View style={styles.modalRoot}>
          <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
          <View style={[styles.sheet, { paddingBottom: keyboardHeight > 0 ? 16 : Math.max(insets.bottom, 24), marginBottom: keyboardHeight }]}>
            <View style={styles.handle} />
            <View style={styles.header}>
              <Text style={styles.title}>+ Add Document</Text>
              <TouchableOpacity onPress={handleClose}><Text style={styles.closeBtn}>✕</Text></TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
              {/* Pick / preview */}
              {picked ? (
                picked.mimeType.startsWith('image') ? (
                  <TouchableOpacity onPress={pickGallery} activeOpacity={0.8}>
                    <Image source={{ uri: picked.uri }} style={styles.preview} resizeMode="cover" />
                    <Text style={styles.replaceHint}>Tap image to replace</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity onPress={pickFile} activeOpacity={0.8} style={styles.filePreview}>
                    <Text style={{ fontSize: 36 }}>📄</Text>
                    <Text style={styles.filePreviewText}>PDF attached</Text>
                    <Text style={styles.replaceHint}>Tap to replace</Text>
                  </TouchableOpacity>
                )
              ) : (
                <View style={styles.pickRow}>
                  <TouchableOpacity style={styles.pickBtn} onPress={takePhoto}>
                    <Text style={styles.pickIcon}>📷</Text>
                    <Text style={styles.pickLabel}>Camera</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickBtn} onPress={pickGallery}>
                    <Text style={styles.pickIcon}>🖼️</Text>
                    <Text style={styles.pickLabel}>Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.pickBtn} onPress={pickFile}>
                    <Text style={styles.pickIcon}>📎</Text>
                    <Text style={styles.pickLabel}>Files</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Name */}
              <View style={styles.field}>
                <Text style={styles.label}>Name</Text>
                <TextInput value={name} onChangeText={setName} placeholder="e.g. Bike Insurance 2026" placeholderTextColor={c.textFaint} style={styles.input} maxLength={200} />
              </View>

              {/* Category */}
              <View style={styles.field}>
                <Text style={styles.label}>Category</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 4 }}>
                    {CATEGORIES.map(cat => (
                      <TouchableOpacity key={cat} onPress={() => setCategory(cat)} style={[styles.chip, category === cat && styles.chipActive]}>
                        <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>

              {/* Expiry */}
              <DatePickerField label="Expiry / Renewal (optional)" value={expiresAt} onChange={setExpiresAt} placeholder="Tap to pick (optional)" optional style={{ marginBottom: 14 }} />

              {/* Note */}
              <View style={styles.field}>
                <Text style={styles.label}>Note <Text style={{ color: c.textFaint }}>(optional)</Text></Text>
                <TextInput value={note} onChangeText={setNote} placeholder="e.g. Policy no. 12345" placeholderTextColor={c.textFaint} style={styles.input} maxLength={300} />
              </View>

              <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.6 }]} onPress={handleSubmit} disabled={loading}>
                {loading ? <ActivityIndicator color={c.onColor} /> : <Text style={styles.submitText}>Save Document</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <AppAlert visible={alertInfo !== null} title={alertInfo?.title ?? ''} message={alertInfo?.message ?? ''} onClose={() => setAlertInfo(null)} />
    </>
  );
}

const makeStyles = (c: Theme) => StyleSheet.create({
  modalRoot: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: c.overlay },
  sheet: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 20, paddingTop: 12, maxHeight: '90%' },
  handle: { width: 40, height: 4, backgroundColor: c.inputBorder, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 18, fontWeight: '700', color: c.text },
  closeBtn: { fontSize: 18, color: c.textFaint, padding: 4 },

  pickRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  pickBtn: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 22, borderRadius: 14, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg },
  pickIcon: { fontSize: 28 },
  pickLabel: { fontSize: 13, fontWeight: '600', color: c.textMuted },
  preview: { width: '100%', height: 180, borderRadius: 14, backgroundColor: c.track },
  filePreview: { alignItems: 'center', paddingVertical: 24, borderRadius: 14, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.inputBg, marginBottom: 8 },
  filePreviewText: { fontSize: 14, fontWeight: '600', color: c.text, marginTop: 6 },
  replaceHint: { fontSize: 11, color: c.textFaint, textAlign: 'center', marginTop: 6, marginBottom: 8 },

  field: { marginBottom: 14 },
  label: { fontSize: 12, fontWeight: '500', color: c.textMuted, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.text, backgroundColor: c.inputBg },

  chip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 99, borderWidth: 1, borderColor: c.inputBorder, backgroundColor: c.card },
  chipActive: { backgroundColor: c.primary, borderColor: c.primary },
  chipText: { fontSize: 13, color: c.textMuted, fontWeight: '500' },
  chipTextActive: { color: c.onColor },

  submitBtn: { backgroundColor: c.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  submitText: { color: c.onColor, fontSize: 16, fontWeight: '700' },
});
