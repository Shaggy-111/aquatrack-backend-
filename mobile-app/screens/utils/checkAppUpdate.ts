import { Alert, Linking } from 'react-native';
import DeviceInfo from 'react-native-device-info';

export const checkAppUpdate = async () => {
  try {
    const currentVersion = DeviceInfo.getVersion();

    const res = await fetch("https://your-api.com/app-version");
    const data = await res.json();

    if (data.latest_version !== currentVersion) {
      Alert.alert(
        "Update Available",
        "Please update the app to continue",
        [
          {
            text: "Update",
            onPress: () => {
              Linking.openURL("https://play.google.com/store/apps/details?id=your.package.name");
            }
          }
        ],
        { cancelable: false }
      );
    }
  } catch (e) {
    console.log("Update check failed", e);
  }
};