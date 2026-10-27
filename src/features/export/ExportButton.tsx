import { Button, Dialog, Portal, Stack, Text } from '@chakra-ui/react'
import { useState } from 'react'
import { dataApi, type Summary } from '../../worker/client'
import { formatCount } from '../format'

/**
 * The output: the same file with the fixes applied, downloaded as <name>.fixed.csv.
 * The original file on disk is never touched. If problems are left, say so before downloading.
 */
export function ExportButton({ summary, fileName }: { summary: Summary; fileName: string }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const open = summary.rowsAutoFixable + summary.rowsManual

  const download = async () => {
    setConfirming(false)
    setBusy(true)
    try {
      const blob = await dataApi.exportCsv()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.replace(/\.csv$/i, '') + '.fixed.csv'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" colorPalette="blue" loading={busy} onClick={() => (open > 0 ? setConfirming(true) : download())}>
        Download fixed file
      </Button>
      {confirming && (
        <Dialog.Root open onOpenChange={(e) => !e.open && setConfirming(false)} role="alertdialog">
          <Portal>
            <Dialog.Backdrop />
            <Dialog.Positioner>
              <Dialog.Content>
                <Dialog.Header>
                  <Dialog.Title>{formatCount(open)} rows still have problems</Dialog.Title>
                </Dialog.Header>
                <Dialog.Body>
                  <Stack gap="3">
                    {summary.rowsAutoFixable > 0 && (
                      <Text>
                        {formatCount(summary.rowsAutoFixable)} of them we can fix for you automatically. Use "Review &
                        apply all fixes" on the overview first if you want them fixed.
                      </Text>
                    )}
                    <Text>
                      Rows with problems are exported exactly as they are now. Your original file isn't changed; you get a
                      new copy with your fixes.
                    </Text>
                  </Stack>
                </Dialog.Body>
                <Dialog.Footer>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    Keep fixing
                  </Button>
                  <Button colorPalette="green" onClick={download}>
                    Download anyway
                  </Button>
                </Dialog.Footer>
              </Dialog.Content>
            </Dialog.Positioner>
          </Portal>
        </Dialog.Root>
      )}
    </>
  )
}
