# Demo transcript

One block per chapter tag. Pause the video at each tag and read the block.

---

## Intro

Hi, I'm Mohammed, based in Berlin. Let me walk you through my home assignment.

The task was a review-and-fix flow for a messy customer file, two hundred thousand rows, for people who aren't technical. I cared about three things: the browser should never feel slow, you should only deal with one problem at a time, and anything you change, you can undo.

---

## 1 · Load

So, I drop the file in. All the heavy work happens in a Web Worker, off the main thread, and the whole file is read and checked in about a second.

---

## 2 · Overview

First thing you see is where you stand. It works like a KPI dashboard: one bar, then a card for each problem, biggest first. The ones we can fix automatically come first, because that's where the quick wins are.

---

## 3 · Understand

Let's open countries. Now the table only shows rows with that problem, and only that column is highlighted, so you're not staring at a sea of red. If you're not sure what's wrong, this icon explains it in plain English.

---

## 4 · Fix one

Each cell already shows its fix. One click applies it. Changed cells get a little dot, and you can undo just that cell.

---

## 5 · Correct by hand

Some values need a person, like the thirtieth of February. You edit right in the cell, and it's checked as you type, with the same rules as the import.

---

## 6 · Fix in bulk

For the big ones, you review before anything changes. The changes are grouped by value, so sixty-seven thousand edits turn into about twenty lines you can actually read. Untick what you're unsure about, apply, and one undo takes it all back.

---

## 7 · Find and decide

Here's something the tool can't decide for you: plans it doesn't recognise. I search just the plan column, sort, select a few rows, and set them all at once. The filter, search and sort are in the URL too.

---

## 8 · Duplicates

Duplicates stay in the same table, grouped together. Most of them are actually different people sharing an email, so "Fix" is the first option. If it really is the same person, "Merge" lets you pick the values to keep, and checks the result first.

---

## 9 · Finish

Last step: apply everything that's safe, and download. Your original file is never touched; you get a fixed copy.

---

## Closing

One more thing: the validation rules are configuration, not code, so in production they'd come from the importer's schema. What I'd add next is saving work across reloads, tests, and the import summary screen. The details and trade-offs are in the design doc. Thanks.
