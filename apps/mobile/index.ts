// App entry. Same as Expo Router's default entry, plus the Android home-screen
// widget handler, which must be registered at startup so Android can render
// widgets headlessly (even when the app isn't open).
import 'expo-router/entry';
import { Platform } from 'react-native';
import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './widgets/taskHandler';

if (Platform.OS === 'android') {
  registerWidgetTaskHandler(widgetTaskHandler);
}
