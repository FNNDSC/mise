---
"@fnndsc/argus": minor
"@fnndsc/porter": minor
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
"@fnndsc/chili": minor
"@fnndsc/cumin": minor
"@fnndsc/fond": minor
"@fnndsc/menu": minor
"@fnndsc/orrery": minor
"@fnndsc/salsa": minor
"@fnndsc/stratus": minor
---

Every function name now says what it does: the 462 that put a preposition where the verb goes are renamed (#1227).

The style guide names a function `<subject>[Qualifier]_<verb>[Adverb]`. Names such as `answerRows_of`, `seriesUID_ofPath`, `options_toParams` and `ask_onPane` put a preposition in the verb's place, which names the result without saying whether the function derives, parses, builds or renders it. They are now `answerRows_derive`, `seriesUID_parse`, `options_convertToParams` and `askOnPane_await`. A preposition may still qualify the verb (`x_readFromCache`) or the object (`askOnPane_await`); it may not start the method.

`npm run lint:rpn` (`scripts/rpn-prepositions.mjs`) refuses a function, `const` function or underscored method whose method is, or starts with, `of`, `to`, `with`, `from`, `for`, `by`, `as`, `in`, `on` or `at`, and CI runs it. The exported names change with no aliases kept: nothing outside this repository imports them.
