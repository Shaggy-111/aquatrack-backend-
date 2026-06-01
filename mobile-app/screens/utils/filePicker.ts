import { launchImageLibrary } from 'react-native-image-picker';
import { Alert } from 'react-native';

interface PickedFile {
    uri: string;
    name: string;
    type: string;
    size?: number | null;
}

export const pickPDF = async (): Promise<PickedFile | null> => {
    try {
        const result = await launchImageLibrary({
            mediaType: 'mixed', // This allows picking images, videos, or documents
            includeExtra: true,
            selectionLimit: 1, // Only allow one file to be picked
        });

        if (result.didCancel) {
            console.log('User cancelled the file picker.');
            return null;
        }

        if (result.errorCode) {
            console.error('Image Picker Error:', result.errorMessage);
            Alert.alert('Error', result.errorMessage || 'Failed to pick file.');
            return null;
        }

        const file = result.assets?.[0]; // Get the first asset from the result
        if (file) {
            console.log(
                'File picked:',
                file.uri,
                file.fileName,
                file.type,
                file.fileSize
            );

            // You can add logic here to check if the file is a PDF
            if (file.type === 'application/pdf') {
                return {
                    uri: file.uri || '',
                    name: file.fileName || 'document.pdf',
                    type: file.type || 'application/pdf',
                    size: file.fileSize || null,
                };
            } else {
                Alert.alert('Error', 'Please select a PDF file.');
                return null;
            }
        }

        return null;
    } catch (err) {
        console.error('File pick error in component:', err);
        Alert.alert('Error', 'An unexpected error occurred while picking a file.');
        return null;
    }
};