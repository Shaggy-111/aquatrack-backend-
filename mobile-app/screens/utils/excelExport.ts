import { Alert, PermissionsAndroid, Platform } from 'react-native';
import RNFS from 'react-native-fs';
import ExcelJS from 'exceljs';

interface ExcelDataRow {
  [key: string]: string | number;
}

// Request storage permission (needed for Android 10/11+)
async function requestStoragePermission() {
  if (Platform.OS === 'android') {
    try {
      const granted = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
        {
          title: 'Storage Permission Required',
          message: 'App needs access to your storage to save exported files.',
          buttonNegative: 'Cancel',
          buttonPositive: 'OK',
        }
      );
      return granted === PermissionsAndroid.RESULTS.GRANTED;
    } catch (err) {
      console.warn(err);
      return false;
    }
  }
  return true;
}

export const exportToExcel = async (data: ExcelDataRow[], fileName: string) => {
  try {
    // Ask for storage permission
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'Cannot save file without storage permission.');
      return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Orders');

    if (data.length > 0) {
      const headers = Object.keys(data[0]);
      worksheet.addRow(headers);
      data.forEach(row => {
        worksheet.addRow(Object.values(row));
      });
    } else {
      Alert.alert('No Data', 'No data to export.');
      return;
    }

    // Convert workbook to base64
    const buffer = await workbook.xlsx.writeBuffer();
    const fileBase64 = buffer.toString('base64');

    // 📂 Save in Downloads folder
    const directoryPath = `${RNFS.DownloadDirectoryPath}/AquaTrack_Exports`;
    const filePath = `${directoryPath}/${fileName}.xlsx`;

    // Create folder if not exists
    const directoryExists = await RNFS.exists(directoryPath);
    if (!directoryExists) {
      await RNFS.mkdir(directoryPath);
    }

    // Save file
    await RNFS.writeFile(filePath, fileBase64, 'base64');

    console.log('File saved to:', filePath);
    Alert.alert(
      'Success',
      `Orders exported successfully!\n\nYou can find the file in Downloads/AquaTrack_Exports/\n\nFile name: ${fileName}.xlsx`
    );
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error exporting data to Excel:', error);
      Alert.alert('Export Error', error.message);
    } else {
      Alert.alert('Export Error', 'An unexpected error occurred. Please try again.');
    }
  }
};
