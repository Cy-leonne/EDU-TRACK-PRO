import React, { useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';

import { ALLOWED_UPLOAD_EXTENSIONS, ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '@edutrack/shared-config';
import { Banner, Button, Card, Empty, Row, Screen } from '../components/ui';
import { useApi } from '../components/useApi';
import { api, ApiError, upload } from '../api/client';
import { useSession } from '../lib/session';
import { formatDate, formatDateTime } from '../lib/format';
import { colors, spacing } from '../lib/theme';

interface Assignment { id: string; title: string; instructions?: string | null; learningAreaName?: string; dueDate?: string | null; maxScore?: number | null; classId: string }
interface Submission {
  id: string;
  assignmentId: string;
  assignmentTitle: string;
  learnerId: string;
  status: string;
  isLate?: boolean;
  submittedAt?: string;
  score?: number | null;
  feedback?: string | null;
  returnedReason?: string | null;
  file?: { id: string; name?: string | null } | null;
}

type Picked = { uri: string; name: string; type: string; isImage: boolean } | null;

const MAX_UPLOAD_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

/** Client-side pre-check so a 40 MB video never wastes the guardian's data bundle. */
function rejectIfUnusable(file: { name: string; type: string; size?: number }): string | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_UPLOAD_TYPES.includes(file.type as (typeof ALLOWED_UPLOAD_TYPES)[number]) && !ALLOWED_UPLOAD_EXTENSIONS.includes(extension as (typeof ALLOWED_UPLOAD_EXTENSIONS)[number])) {
    return `That file type is not accepted. Allowed: ${ALLOWED_UPLOAD_EXTENSIONS.join(', ')}.`;
  }
  if (file.size && file.size > MAX_UPLOAD_BYTES) {
    return `That file is larger than ${MAX_UPLOAD_MB} MB. Take a smaller photo or compress the PDF.`;
  }
  return null;
}

/**
 * Guardian hand-in.
 *
 * Photograph the completed work with the camera, or pick a PDF from the phone.
 * The upload goes to private storage; the API decides whether the hand-in is late
 * and records that a guardian submitted it on the learner's behalf.
 */
export function HandInScreen() {
  const { user } = useSession();
  const dashboard = useApi<{ selectedLearnerId?: string | null; learners: Array<{ id: string; fullName: string; classId: string; className: string }> }>('/dashboard/parent');
  const learner = dashboard.data?.learners.find((item) => item.id === (dashboard.data?.selectedLearnerId ?? ''));
  const learnerId = learner?.id ?? null;

  const assignments = useApi<Assignment[]>(learner ? '/resources/assignments' : null, learner ? { classId: learner.classId } : undefined);
  const submissions = useApi<Submission[]>('/submissions', learnerId ? { learnerId } : undefined);

  const [picked, setPicked] = useState<Picked>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'warning' | 'danger'; text: string } | null>(null);

  const handedIn = new Set((submissions.data ?? []).map((item) => item.assignmentId));
  const open = (assignments.data ?? []).filter((assignment) => !handedIn.has(assignment.id));

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setMessage({ tone: 'warning', text: 'Camera permission is off. Enable it in your phone settings, or choose a file instead.' });
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7, allowsEditing: false });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const problem = rejectIfUnusable({ name: 'hand-in.jpg', type: 'image/jpeg', size: asset.fileSize });
    if (problem) {
      setMessage({ tone: 'warning', text: problem });
      return;
    }
    setPicked({ uri: asset.uri, name: `hand-in-${Date.now()}.jpg`, type: 'image/jpeg', isImage: true });
  };

  const chooseFile = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'image/*'], copyToCacheDirectory: true });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const candidate = {
      uri: asset.uri,
      name: asset.name ?? `hand-in-${Date.now()}.pdf`,
      type: asset.mimeType ?? 'application/pdf',
      isImage: (asset.mimeType ?? '').startsWith('image/'),
      size: asset.size,
    };
    const problem = rejectIfUnusable(candidate);
    if (problem) {
      setMessage({ tone: 'warning', text: problem });
      return;
    }
    setPicked({ uri: candidate.uri, name: candidate.name, type: candidate.type, isImage: candidate.isImage });
  };

  const submit = async (assignment: Assignment) => {
    if (!learnerId) return;
    if (!picked && note.trim().length < 3) {
      setMessage({ tone: 'warning', text: 'Attach a photo or PDF of the work, or write a short note describing what was done.' });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let fileId: string | null = null;
      if (picked) {
        const uploaded = await upload<{ id: string; fileName: string }>('/files/upload?purpose=SUBMISSION', { uri: picked.uri, name: picked.name, type: picked.type });
        fileId = uploaded.id;
      }
      await api.post('/submissions', { assignmentId: assignment.id, learnerId, fileId, note: note.trim() || null });
      setPicked(null);
      setNote('');
      setMessage({ tone: 'success', text: `Handed in “${assignment.title}”. The teacher has been notified.` });
      await submissions.reload();
    } catch (caught) {
      setMessage({ tone: 'danger', text: caught instanceof ApiError ? caught.message : 'The hand-in could not be sent. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  };

  if (user?.role !== 'PARENT') {
    return (
      <Screen title="Hand-ins">
        <Banner tone="info">Reviewing hand-ins is done on the web workspace, where you can open each file side by side with the class list.</Banner>
      </Screen>
    );
  }

  return (
    <Screen title="Hand in work" subtitle={learner ? `${learner.fullName} · ${learner.className}` : undefined} onRefresh={() => void assignments.reload()} refreshing={assignments.loading}>
      {message ? <Banner tone={message.tone}>{message.text}</Banner> : null}

      {picked ? (
        <Card title="Attached to the next hand-in">
          {picked.isImage ? <Image source={{ uri: picked.uri }} style={styles.preview} resizeMode="cover" /> : null}
          <Row label={picked.name} value={picked.isImage ? 'Photo' : 'Document'} />
          <Button label="Remove attachment" variant="ghost" onPress={() => setPicked(null)} />
        </Card>
      ) : (
        <Card title="Attach the work">
          <Button label="Take a photo" onPress={() => void takePhoto()} />
          <Button label="Choose a file (PDF or image)" variant="secondary" onPress={() => void chooseFile()} />
          <Text style={styles.hint}>
            Photos of exercise-book pages are easiest for a teacher to review. PDF or image, up to {MAX_UPLOAD_MB} MB. The server re-checks the file signature, so a
            renamed file is still rejected.
          </Text>
        </Card>
      )}

      <Card title="Open assignments">
        {open.length === 0 ? (
          <Empty title="Nothing outstanding" hint="Everything set for this class has been handed in." />
        ) : (
          open.map((assignment) => (
            <View key={assignment.id} style={styles.assignment}>
              <Text style={styles.assignmentTitle}>{assignment.title}</Text>
              <Text style={styles.assignmentMeta}>
                {assignment.learningAreaName} {assignment.dueDate ? `· due ${formatDate(assignment.dueDate)}` : ''}
                {assignment.maxScore ? ` · out of ${assignment.maxScore}` : ''}
              </Text>
              {assignment.instructions ? <Text style={styles.instructions}>{assignment.instructions}</Text> : null}
              <Button label="Hand this in" onPress={() => void submit(assignment)} loading={busy} />
            </View>
          ))
        )}
      </Card>

      <Card title="Already handed in">
        {(submissions.data ?? []).length === 0 ? (
          <Text style={styles.hint}>Nothing yet.</Text>
        ) : (
          (submissions.data ?? []).map((submission) => (
            <View key={submission.id} style={styles.result}>
              <Text style={styles.assignmentTitle}>{submission.assignmentTitle}</Text>
              <Text style={styles.assignmentMeta}>
                {submission.status.toLowerCase()}
                {submission.isLate ? ' · late' : ''} · {formatDateTime(submission.submittedAt)}
              </Text>
              {submission.score != null ? <Text style={styles.assignmentMeta}>Score: {submission.score}</Text> : null}
              {submission.feedback ? <Text style={styles.instructions}>{submission.feedback}</Text> : null}
              {submission.returnedReason ? <Text style={styles.returned}>Returned: {submission.returnedReason}</Text> : null}
            </View>
          ))
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 160, borderRadius: 10, marginBottom: spacing.sm },
  hint: { fontSize: 12, color: colors.muted, marginTop: spacing.sm, lineHeight: 18 },
  assignment: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md, marginTop: spacing.sm },
  assignmentTitle: { fontSize: 14, fontWeight: '700', color: colors.text },
  assignmentMeta: { fontSize: 12, color: colors.muted, marginTop: 2 },
  instructions: { fontSize: 12, color: colors.text, marginTop: 4, lineHeight: 18 },
  returned: { fontSize: 12, color: colors.warning, marginTop: 4, lineHeight: 18 },
  result: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.sm, marginTop: spacing.sm },
});
