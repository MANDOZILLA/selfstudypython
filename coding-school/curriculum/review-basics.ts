import type { MissionTask, TaskVariant } from "../lib/mission-types";

const codeVariant = (id: string, skillId: string, checks: string[], starter: string): TaskVariant => ({
  id: `${id}-retrieval-v1`, contextId: `${id}-retrieval`, graderId: `${id}-retrieval-v1`, exerciseId: `${id}-retrieval`,
  starterFiles: { "main.py": starter }, skillChecks: { [skillId]: checks },
});

const retrieval = (id: string, title: string, skillId: string, explanation: string, examples: string[], requirements: string[], hints: string[], starter: string): MissionTask => ({
  id: `${id}-retrieval`, title: `Review: ${title}`, kind: "code", purpose: "retrieval", skillIds: [skillId], introducedSkillIds: [],
  explanation, examples, requirements, hints,
  variants: [codeVariant(id, skillId, skillId === "py-classes" ? ["class", "method", "state", "solve"] : ["sample", "edge", "shape", "behavior"], starter)],
});

export const BASICS_REVIEW_TASKS: MissionTask[] = [
  retrieval("py-values", "make a snack label", "py-values",
    "A snack stand needs a short label for each order. Combine text and numbers in solve, then return the finished label.",
    ["solve('Muffin', 2) gives 'Muffin x 2'.", "solve('Juice', 1) gives 'Juice x 1'."],
    ["Define solve(item, count) and return the label.", "Keep the item text and count in the result."],
    ["An f-string can place values inside text.", "Return the string from solve."],
    "def solve(item, count):\n    # 1. Put item and count into a label.\n    # 2. Return the label.\n    return \"\"\n"),
  retrieval("py-conditionals", "sort garden pots", "py-conditionals",
    "A gardener sorts pots by their height. Return short for heights below 20, medium below 40, and tall for the rest.",
    ["solve(12) gives 'short'.", "solve(20) gives 'medium'; solve(40) gives 'tall'."],
    ["Define solve(height) and return one label.", "Use the exact height boundaries in the instructions."],
    ["Check the smaller boundary first.", "Use elif for the second height range."],
    "def solve(height):\n    # 1. Check whether the pot is short.\n    # 2. Check whether it is medium.\n    # 3. Return its label.\n    return \"\"\n"),
  retrieval("py-loops", "count practice rounds", "py-loops",
    "A coach records completed rounds. Visit every score and return how many are at least 5. Use a loop to count matches.",
    ["solve([2, 5, 7]) gives 2.", "solve([]) gives 0."],
    ["Define solve(scores) and return a count.", "Count each score that is 5 or higher."],
    ["Start a counter at zero.", "Visit each score with a for loop."],
    "def solve(scores):\n    count = 0\n    # 1. Visit each score.\n    # 2. Count scores of at least 5.\n    return count\n"),
  retrieval("py-lists-strings", "prepare trail names", "py-lists-strings",
    "A park has trail names with extra spaces and mixed case. Return a new list with each name trimmed and written in lowercase.",
    ["solve([' Pine ', 'LAKE']) gives ['pine', 'lake'].", "solve([]) gives []."],
    ["Define solve(names) and return a new list.", "Trim each name, then make it lowercase."],
    ["Use strip() and lower() on each name.", "Append each cleaned name to a new list."],
    "def solve(names):\n    cleaned = []\n    # 1. Visit each name.\n    # 2. Trim it and make it lowercase.\n    # 3. Add it to cleaned.\n    return cleaned\n"),
  retrieval("py-dicts", "count garden colors", "py-dicts",
    "A garden journal lists flower colors. Return a dictionary with the number of times each color appears, keeping the given spelling.",
    ["solve(['red', 'blue', 'red']) gives {'red': 2, 'blue': 1}.", "solve([]) gives {}."],
    ["Define solve(colors) and return a dictionary.", "Increase each color's count as you visit it."],
    ["Start with an empty dictionary.", "Use get(color, 0) before adding one."],
    "def solve(colors):\n    counts = {}\n    # 1. Visit each color.\n    # 2. Increase its count in counts.\n    return counts\n"),
  retrieval("py-classes", "track library books", "py-classes",
    "Make a Book class that stores a title and whether it is borrowed. A new book is available; borrow changes its state. solve returns the final state.",
    ["Book('River').borrow() marks it borrowed.", "solve('River', True) gives {'title': 'River', 'borrowed': True}."],
    ["Define Book with title and borrowed attributes.", "Define solve(title, borrow_it) to use a Book."],
    ["Set borrowed to False in __init__.", "Change the object's attribute inside borrow()."],
    "class Book:\n    def __init__(self, title):\n        self.title = title\n        self.borrowed = False\n\n    def borrow(self):\n        # 1. Mark this book as borrowed.\n        pass\n\ndef solve(title, borrow_it):\n    # 2. Create a Book and optionally borrow it.\n    # 3. Return its title and borrowed state.\n    return {}\n"),
];
