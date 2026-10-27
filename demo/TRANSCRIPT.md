# Demo transcript

One block per slide, in the order of the video. Pause the video at each slide flip and read the block.

---

## Intro

Hi, I'm going to walk you through Ingestro's review-and-fix flow.

Picture someone in operations who has just been handed a customer export to import. Two hundred thousand rows. Countries spelled five different ways, dates in three formats, amounts with euro signs, duplicate emails.

They're not a data person, and they don't need to be. This tool helps them find what's wrong, understand it, and fix it, without the browser ever slowing down.

---

## 1 · Load

It starts with dropping the file in.

The whole file is read and checked in about a second. All of that work happens in the background, so the page stays smooth the entire time, and the file on your computer is never touched.

---

## 2 · Overview

The first thing you see is where you stand.

One bar: green is fine, blue is what we can fix for you, orange needs your decision. Here that's fifty-three, thirty-seven and ten percent.

Below it, each kind of problem is a card, biggest first, and the ones we can fix automatically come first, because that's where the quick wins are.

---

## 3 · Understand

Let's open the biggest one: countries.

The table now shows only the rows with that problem, and only that column is highlighted. No wall of red.

If you're not sure what's wrong, this little icon explains it in plain words, with an example of a good value. And every cell already shows the fix it would make.

---

## 4 · Fix one

For a single value, you just click the suggestion.

The cell gets a small blue dot so you can see what you changed. Click it, and you see what it was before, with an undo for just that cell.

---

## 5 · Correct by hand

Some values have no obvious answer, like the thirtieth of February.

You double-click the cell and type. It's checked as you type, so you see right away whether the new value works. Enter saves it.

---

## 6 · Fix in bulk

Back to countries: sixty-seven thousand of them. Nobody wants to click those one by one.

Review and fix all shows every change grouped by value, with how many rows each one affects. If you're unsure about one, say Polska, untick it.

One click applies the rest, and one undo takes it all back. Redo puts it back again.

---

## 7 · Find and decide

Now something the tool can't decide for you: plans it doesn't recognise.

You can search a single column, here "plan: enterprize", sort, and select rows with a click and shift-arrow. Then set one value for all of them at once.

And everything you see here, the filter, the search and the sort, is in the address bar, so you can share the exact view with a colleague.

---

## 8 · Duplicates

Duplicate emails stay in the same table, grouped together, so each group's rows sit next to each other.

Most of them are different people sharing an email, so you fix the one that doesn't belong.

When it's really the same person, you merge. You pick the row to keep, choose the values you want, and the result is checked before anything happens. The merged row stays visible, crossed out, so nothing disappears silently.

---

## 9 · Finish

Last step: apply everything that's safe in one go, then download the fixed file.

If some problems are still open, it tells you how many before you download. You get a new copy; your original file stays as it was.

---

## Recap

So, to recap.

It's fast: two hundred thousand rows without the page ever freezing.

It's clear: one problem at a time, in plain words.

And it's safe: you see every change before it happens, and you can undo all of it.

Thanks for watching.
