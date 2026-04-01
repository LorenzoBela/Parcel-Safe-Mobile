import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Modal, Portal, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAppTheme } from '../../context/ThemeContext';

type Props = {
  visible: boolean;
  currentVersion: string;
  latestVersion: string | null;
  releaseNotes: string[];
  onUpdateNow: () => void;
  onRecheck: () => void;
  isChecking: boolean;
};

type Palette = {
  card: string;
  border: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  accent: string;
  pillBg: string;
};

const light: Palette = {
  card: '#F6F6F6',
  border: '#E5E5EA',
  textPrimary: '#000000',
  textSecondary: '#6B6B6B',
  textTertiary: '#AEAEB2',
  accent: '#000000',
  pillBg: '#F2F2F7',
};

const dark: Palette = {
  card: '#141414',
  border: '#2C2C2E',
  textPrimary: '#FFFFFF',
  textSecondary: '#8E8E93',
  textTertiary: '#636366',
  accent: '#FFFFFF',
  pillBg: '#1C1C1E',
};

export default function BinaryUpdateRequiredModal({
  visible,
  currentVersion,
  latestVersion,
  releaseNotes,
  onUpdateNow,
  onRecheck,
  isChecking,
}: Props) {
  const { isDarkMode } = useAppTheme();
  const c = isDarkMode ? dark : light;
  const insets = useSafeAreaInsets();

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={() => {
          /* intentionally non-dismissible */
        }}
        dismissable={false}
        contentContainerStyle={[
          styles.modalContainer,
          {
            backgroundColor: c.card,
            borderColor: c.border,
            paddingBottom: Math.max(insets.bottom + 20, 20),
          },
        ]}
        style={styles.modalOverlay}
      >
        <View style={styles.content}>
          <View style={[styles.iconContainer, { backgroundColor: c.accent + '15' }]}>
            <MaterialCommunityIcons name="download-lock" size={30} color={c.accent} />
          </View>

          <Text style={[styles.title, { color: c.textPrimary }]}>Update Required</Text>
          <Text style={[styles.description, { color: c.textSecondary }]}> 
            A new app package is required to continue. Download and install the latest APK.
          </Text>

          <View style={styles.versionRow}>
            <View style={[styles.versionPill, { backgroundColor: c.pillBg, borderColor: c.border }]}>
              <Text style={[styles.versionText, { color: c.textTertiary }]}>Current {currentVersion}</Text>
            </View>
            <View style={[styles.versionPill, { backgroundColor: c.pillBg, borderColor: c.border }]}>
              <Text style={[styles.versionText, { color: c.textTertiary }]}>Latest {latestVersion || '...'}</Text>
            </View>
          </View>

          {releaseNotes.length > 0 ? (
            <View style={[styles.notesBox, { borderColor: c.border, backgroundColor: c.pillBg }]}> 
              <Text style={[styles.notesTitle, { color: c.textPrimary }]}>What&apos;s new</Text>
              {releaseNotes.map((note, index) => (
                <Text key={`${note}-${index}`} style={[styles.noteLine, { color: c.textSecondary }]}>
                  • {note}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.buttonContainer}>
            <TouchableOpacity
              style={[styles.secondaryButton, { borderColor: c.border, backgroundColor: c.pillBg }]}
              onPress={onRecheck}
              disabled={isChecking}
              activeOpacity={0.7}
            >
              <Text style={[styles.secondaryText, { color: c.textPrimary }]}> 
                {isChecking ? 'Checking...' : 'I Installed, Recheck'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryButton, { backgroundColor: c.accent }]}
              onPress={onUpdateNow}
              activeOpacity={0.7}
            >
              <Text style={[styles.primaryText, { color: isDarkMode ? '#000000' : '#FFFFFF' }]}>Download APK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    justifyContent: 'flex-end',
    margin: 0,
  },
  modalContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    marginHorizontal: 0,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 24,
    alignItems: 'center',
  },
  iconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    marginBottom: 10,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  description: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  versionRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  versionPill: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  versionText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    textAlign: 'center',
  },
  notesBox: {
    width: '100%',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 18,
  },
  notesTitle: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    marginBottom: 6,
  },
  noteLine: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 2,
  },
  buttonContainer: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  secondaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  primaryButton: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  secondaryText: {
    fontSize: 13,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
  },
  primaryText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
});
