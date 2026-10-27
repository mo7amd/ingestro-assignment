import { Button, HStack, Input, NativeSelect, Text } from '@chakra-ui/react'
import { useEffect, useState } from 'react'
import { COLUMN_LABELS, COLUMNS, issueType, type Column } from '../../domain/config'
import { dataApi, type ValueCheck } from '../../worker/client'
import { formatCount } from '../format'

interface Props {
  rowIds: number[]
  /** focus mode column: actions default to it */
  focusColumn?: Column
  onFix: () => void
  onSet: (column: Column, value: string) => void
  onClear: () => void
  /** duplicate views: merge the selected rows into one */
  onMerge?: () => void
}

/** Floating bar while 2+ rows are selected: fix them, or set one value for all of them. */
export function SelectionBar({ rowIds, focusColumn, onFix, onSet, onClear, onMerge }: Props) {
  const [column, setColumn] = useState<Column>(focusColumn ?? COLUMNS[0])
  const [value, setValue] = useState('')
  const [check, setCheck] = useState<ValueCheck | null>(null)

  useEffect(() => setColumn(focusColumn ?? COLUMNS[0]), [focusColumn])

  // Check the value against the first selected row, with the same rules as the import.
  const firstRow = rowIds[0]
  useEffect(() => {
    let live = true
    setCheck(null)
    if (value === '') return
    dataApi.checkValue(firstRow, column, value).then((r) => live && setCheck(r))
    return () => {
      live = false
    }
  }, [value, column, firstRow])

  return (
    <HStack
      position="absolute"
      bottom="4"
      left="50%"
      transform="translateX(-50%)"
      zIndex="10"
      gap="3"
      px="4"
      py="2"
      bg="bg.panel"
      borderWidth="1px"
      borderRadius="xl"
      shadow="lg"
      fontSize="sm"
      wrap="wrap"
    >
      <Text fontWeight="semibold">{formatCount(rowIds.length)} selected</Text>
      {onMerge ? (
        <Button size="xs" colorPalette="blue" onClick={onMerge}>
          Merge {formatCount(rowIds.length)} rows…
        </Button>
      ) : (
        <Button size="xs" colorPalette="blue" onClick={onFix}>
          Apply suggested fixes
        </Button>
      )}
      <Text color="fg.muted">or set</Text>
      <NativeSelect.Root size="xs" w="auto">
        <NativeSelect.Field value={column} onChange={(e) => setColumn(e.currentTarget.value)}>
          {COLUMNS.map((c) => (
            <option key={c} value={c}>
              {COLUMN_LABELS[c]}
            </option>
          ))}
        </NativeSelect.Field>
        <NativeSelect.Indicator />
      </NativeSelect.Root>
      <Text color="fg.muted">to</Text>
      <Input
        size="xs"
        w="36"
        value={value}
        placeholder="new value"
        borderColor={check ? (check.issue ? 'orange.solid' : 'green.solid') : undefined}
        onChange={(e) => setValue(e.currentTarget.value)}
      />
      {check?.issue && (
        <Text color="orange.fg" maxW="48" truncate title={issueType(check.issue).explanation}>
          ⚠ {issueType(check.issue).title}
        </Text>
      )}
      <Button size="xs" variant="outline" disabled={value === '' || !check || check.issue !== null} onClick={() => onSet(column, value)}>
        Set for {formatCount(rowIds.length)}
      </Button>
      <Button size="xs" variant="ghost" onClick={onClear}>
        Clear
      </Button>
    </HStack>
  )
}
