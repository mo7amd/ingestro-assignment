import { Box, Button, FileUpload, Text } from '@chakra-ui/react'

interface Props {
  onFile: (file: File) => void
}

export function FilePicker({ onFile }: Props) {
  return (
    <FileUpload.Root
      accept={['.csv', 'text/csv']}
      maxFiles={1}
      onFileAccept={(d) => d.files[0] && onFile(d.files[0])}
      alignItems="stretch"
    >
      <FileUpload.HiddenInput />
      <FileUpload.Dropzone minH="48" borderRadius="lg">
        <FileUpload.DropzoneContent>
          <Box fontWeight="semibold" fontSize="lg">
            Drop your customer file here
          </Box>
          <Text color="fg.muted">A .csv file, like import-data.csv</Text>
          <FileUpload.Trigger asChild>
            <Button mt="3" colorPalette="blue">
              Choose a file
            </Button>
          </FileUpload.Trigger>
        </FileUpload.DropzoneContent>
      </FileUpload.Dropzone>
    </FileUpload.Root>
  )
}
