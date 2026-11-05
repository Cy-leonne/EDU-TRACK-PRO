import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { Banner, Button, Field } from '../components/ui';
import { useSession } from '../lib/session';
import { colors, spacing } from '../lib/theme';

/**
 * Sign-in for teachers and guardians.
 *
 * The same account works on the web and here. Learners have no accounts: a
 * guardian signs in and chooses which of their linked children to view.
 */
export function SignInScreen() {
  const { signIn, signingIn, error } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  const submit = async () => {
    setValidation(null);
    if (!email.includes('@')) {
      setValidation('Enter the email address your school issued you.');
      return;
    }
    if (password.length < 8) {
      setValidation('Enter your password (8 characters or more).');
      return;
    }
    try {
      await signIn(email, password);
    } catch {
      /* the provider already surfaced the reason */
    }
  };

  return (
    <KeyboardAvoidingView style={styles.wrapper} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.brandBlock}>
        <Text style={styles.brand}>EduTrack Pro</Text>
        <Text style={styles.tagline}>Junior School records · Grades 7–9</Text>
      </View>

      <View style={styles.form}>
        {validation ? <Banner tone="warning">{validation}</Banner> : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Field
          label="Email"
          value={email}
          onChangeText={setEmail}
          placeholder="you@school.example"
          keyboardType="email-address"
          textContentType="username"
          autoComplete="email"
        />
        <Field label="Password" value={password} onChangeText={setPassword} placeholder="••••••••" secureTextEntry textContentType="password" />

        <Button label="Sign in" onPress={submit} loading={signingIn} />
        <Text style={styles.help}>
          Forgotten your password? Ask the school office to send you a reset link, or use “Forgot password” on the web portal.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  wrapper: { flex: 1, backgroundColor: colors.brand, justifyContent: 'center', padding: spacing.xl },
  brandBlock: { marginBottom: spacing.xl },
  brand: { color: '#FFFFFF', fontSize: 30, fontWeight: '800' },
  tagline: { color: '#C7D6E2', fontSize: 14, marginTop: 4 },
  form: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: spacing.lg },
  help: { fontSize: 12, color: colors.muted, marginTop: spacing.md, lineHeight: 18 },
});
