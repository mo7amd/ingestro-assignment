# Demo transcript

One block per chapter tag. Pause the video at each tag and read the block.

---

## Intro

This is a review-and-fix flow for a 200,000-row customer file, built for non-technical users. I focused on three things: keeping the browser responsive, showing one problem at a time, and making every change reversible.

---

## 1 · Load

Parsing and validation run in a Web Worker that also owns the data. The full file is checked in under a second.

---

## 2 · Overview

The overview answers one question: where do I stand. similar to what you see in KPI dashboards, Problems are cards, biggest first, and the ones we can fix automatically come first, because they the low hanging fruits.

---

## 3 · Understand

Opening a card filters the table to that problem and highlights only that column, so there's no wall of red. The explanation sits beside the filter, in plain english.

---

## 4 · Fix one

The suggested fix is a button in the cell. Changed cells are marked, and each one can be undone on its own.

---

## 5 · Correct by hand

Editing runs the same rules as the import, live, so you see whether a value works before you save it.

---

## 6 · Fix in bulk

Bulk fixes always go through a preview, grouped by value, so sixty-seven thousand changes become about twenty readable lines. Applying is a single change set, so one undo reverts all of it.

---

## 7 · Find and decide

Search can target one column. Filter, search and sort live in the URL, so in the future any view can be shared. Selected rows can be set to one value at once.

---

## 8 · Duplicates

Duplicates stay in the table, grouped. Most are different people sharing an email, so "Fix" comes first. "Merge" builds one row from the group and checks it before anything is removed.

---

## 9 · Finish

Apply the remaining automatic fixes, then export. The original file is never modified; you get a corrected copy.

---

## Closing

The validation rules are configuration, not code; in production they'd come from the importer's schema. What's not built yet: saving work across reloads, tests, and the import summary screen. The trade-offs are in the design doc.
