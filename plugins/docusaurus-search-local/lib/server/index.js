"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateOptions = void 0;
const tslib_1 = require("tslib");
const fs_1 = (0, tslib_1.__importDefault)(require("fs"));
const path_1 = (0, tslib_1.__importDefault)(require("path"));
const util_1 = (0, tslib_1.__importDefault)(require("util"));
const utils_validation_1 = require("@docusaurus/utils-validation");
const parse_1 = require("./parse");
const logger_1 = (0, tslib_1.__importDefault)(require("./logger"));
const lunr = require("../lunr.js");
const readFileAsync = util_1.default.promisify(fs_1.default.readFile);
const writeFileAsync = util_1.default.promisify(fs_1.default.writeFile);
// FIXME: Duplicated in src/theme/SearchBar/util.js
function urlMatchesPrefix(url, prefix) {
    if (prefix.startsWith("/")) {
        throw new Error(`prefix must not start with a /. This is a bug.`);
    }
    if (prefix.endsWith("/")) {
        throw new Error(`prefix must not end with a /. This is a bug.`);
    }
    return prefix === "" || url === prefix || url.startsWith(`${prefix}/`);
}
function trimLeadingSlash(path) {
    if (!path || !path.startsWith("/")) {
        return path;
    }
    return path.slice(1);
}
function trimTrailingSlash(path) {
    if (!path || !path.endsWith("/")) {
        return path;
    }
    return path.slice(0, -1);
}
// Copied from Docusaurus, licensed under the MIT License.
// https://github.com/facebook/docusaurus/blob/63bd6b9025be282b50adbc65176598c96fd4f7e9/packages/docusaurus-theme-translations/src/index.ts#L20-L36
function codeTranslationLocalesToTry(locale) {
    const intlLocale = Intl.Locale ? new Intl.Locale(locale) : undefined;
    if (!intlLocale) {
        return [locale];
    }
    // if locale is just a simple language like "pt", we want to fallback to pt-BR (not pt-PT!)
    // see https://github.com/facebook/docusaurus/pull/4536#issuecomment-810088783
    if (intlLocale.language === locale) {
        const maximizedLocale = intlLocale.maximize(); // pt-Latn-BR`
        // ["pt","pt-BR"]
        return [locale, `${maximizedLocale.language}-${maximizedLocale.region}`];
    }
    // if locale is like "pt-BR", we want to fallback to "pt"
    else {
        return [locale, intlLocale.language];
    }
}
const languageSchema = utils_validation_1.Joi.string().valid("ar", "da", "de", "en", "es", "fi", "fr", "hi", "hu", "it", "ja", "nl", "no", "pt", "ro", "ru", "sv", "th", "tr", "vi", "zh");
const optionsSchema = utils_validation_1.Joi.object({
    indexDocs: utils_validation_1.Joi.boolean().default(true),
    indexDocSidebarParentCategories: utils_validation_1.Joi.number()
        .integer()
        .min(0)
        .max(Number.MAX_SAFE_INTEGER)
        .default(0),
    indexBlog: utils_validation_1.Joi.boolean().default(true),
    indexPages: utils_validation_1.Joi.boolean().default(false),
    language: utils_validation_1.Joi.alternatives(languageSchema, utils_validation_1.Joi.array().items(languageSchema)).default("en"),
    style: utils_validation_1.Joi.string().valid("none"),
    lunr: utils_validation_1.Joi.object({
        tokenizerSeparator: utils_validation_1.Joi.object().regex(),
        b: utils_validation_1.Joi.number().min(0).max(1).default(0.75),
        k1: utils_validation_1.Joi.number().min(0).default(1.2),
        titleBoost: utils_validation_1.Joi.number().min(0).default(5),
        contentBoost: utils_validation_1.Joi.number().min(0).default(1),
        parentCategoriesBoost: utils_validation_1.Joi.number().min(0).default(2),
    }).default(),
});
function cmfcmfDocusaurusSearchLocal(context, options) {
    let { indexDocSidebarParentCategories, indexBlog, indexDocs, indexPages, language, style, lunr: { tokenizerSeparator: lunrTokenizerSeparator, k1, b, titleBoost, contentBoost, parentCategoriesBoost, }, } = options;
    if (lunrTokenizerSeparator) {
        // @ts-expect-error
        lunr.tokenizer.separator = lunrTokenizerSeparator;
    }
    if (Array.isArray(language) && language.length === 1) {
        language = language[0];
    }
    let generated = "// THIS FILE IS AUTOGENERATED\n" + "// DO NOT EDIT THIS FILE!\n\n";
    if (style !== "none") {
        generated += 'require("@algolia/autocomplete-theme-classic");\n';
        generated += 'import "./index.css";\n';
    }
    generated += 'const lunr = require("../../../lunr.js");\n';
    function handleLangCode(code) {
        let generated = "";
        if (code === "jp") {
            throw new Error(`Language "jp" is deprecated, please use "ja".`);
        }
        if (code === "ja") {
            require("lunr-languages/tinyseg")(lunr);
            generated += `require("lunr-languages/tinyseg")(lunr);\n`;
        }
        else if (code === "th" || code === "hi") {
            // @ts-expect-error see
            // https://github.com/MihaiValentin/lunr-languages/blob/a62fec97fb1a62bb4581c9b69a5ddedf62f8f62f/test/VersionsAndLanguagesTest.js#L110-L112
            lunr.wordcut = require("lunr-languages/wordcut");
            generated += `lunr.wordcut = require("lunr-languages/wordcut");\n`;
        }
        require(`lunr-languages/lunr.${code}`)(lunr);
        generated += `require("lunr-languages/lunr.${code}")(lunr);\n`;
        return generated;
    }
    if (language !== "en") {
        require("lunr-languages/lunr.stemmer.support")(lunr);
        generated += 'require("lunr-languages/lunr.stemmer.support")(lunr);\n';
        if (Array.isArray(language)) {
            language
                .filter((code) => code !== "en")
                .forEach((code) => {
                generated += handleLangCode(code);
            });
            require("lunr-languages/lunr.multi")(lunr);
            generated += `require("lunr-languages/lunr.multi")(lunr);\n`;
        }
        else {
            generated += handleLangCode(language);
        }
    }
    if (language === "zh") {
        // nodejieba does not run in the browser, so we need to use a custom tokenizer here.
        // FIXME: We should look into compiling nodejieba to WebAssembly and use that instead.
        generated += `\
export const tokenize = (input) => input.trim().toLowerCase()
  .split(${(lunrTokenizerSeparator
            ? lunrTokenizerSeparator
            : /[\s\-]+/).toString()})
  .filter(each => !!each);\n`;
    }
    else if (language === "ja" || language === "th") {
        if (lunrTokenizerSeparator) {
            throw new Error("The lunr.tokenizerSeparator option is not supported for 'ja' and 'th'");
        }
        generated += `\
export const tokenize = (input) => lunr[${JSON.stringify(language)}].tokenizer(input)
  .map(token => token${language === "th" ? "" : ".str"});\n`;
    }
    else {
        if (lunrTokenizerSeparator) {
            generated += `\
lunr.tokenizer.separator = ${lunrTokenizerSeparator.toString()};\n`;
        }
        generated += `\
export const tokenize = (input) => lunr.tokenizer(input)
  .map(token => token.str);\n`;
    }
    generated += `export const mylunr = lunr;\n`;
    ["src", "lib"].forEach((folder) => {
        const generatedPath = path_1.default.join(__dirname, "..", "..", folder, "client", "theme", "SearchBar", "generated.js");
        fs_1.default.writeFileSync(generatedPath, generated);
    });
    return {
        name: "@cmfcmf/docusaurus-search-local",
        getThemePath() {
            return path_1.default.resolve(__dirname, "..", "..", "lib", "client", "theme");
        },
        getTypeScriptThemePath() {
            return path_1.default.resolve(__dirname, "..", "..", "src", "client", "theme");
        },
        getDefaultCodeTranslationMessages: async () => {
            const translationsDir = path_1.default.resolve(__dirname, "..", "..", "codeTranslations");
            const localesToTry = codeTranslationLocalesToTry(context.i18n.currentLocale);
            for (const locale of localesToTry) {
                const translationPath = path_1.default.join(translationsDir, `${locale}.json`);
                if (fs_1.default.existsSync(translationPath)) {
                    return JSON.parse(await fs_1.default.promises.readFile(translationPath, "utf8"));
                }
            }
            return {};
        },
        async contentLoaded({ actions: { setGlobalData } }) {
            setGlobalData({
                titleBoost,
                contentBoost,
                parentCategoriesBoost,
                indexDocSidebarParentCategories,
            });
        },
        async postBuild({ routesPaths = [], outDir, baseUrl, siteConfig: { trailingSlash }, plugins, }) {
            logger_1.default.info("Gathering documents");
            function buildPluginMap(name) {
                return new Map(plugins
                    .filter((plugin) => plugin.name === name)
                    .map((plugin) => [plugin.options.id, plugin]));
            }
            const docsPlugins = buildPluginMap("docusaurus-plugin-content-docs");
            const blogPlugins = buildPluginMap("docusaurus-plugin-content-blog");
            const pagesPlugins = buildPluginMap("docusaurus-plugin-content-pages");
            if (indexDocs && docsPlugins.size === 0) {
                throw new Error('The "indexDocs" option is enabled but no docs plugin has been found.');
            }
            if (indexBlog && blogPlugins.size === 0) {
                throw new Error('The "indexBlog" option is enabled but no blog plugin has been found.');
            }
            if (indexPages && pagesPlugins.size === 0) {
                throw new Error('The "indexPages" option is enabled but no pages plugin has been found.');
            }
            const data = routesPaths
                .flatMap((url) => {
                // baseUrl includes the language prefix, thus `route` will be language-agnostic.
                const route = url.substring(baseUrl.length);
                if (!url.startsWith(baseUrl)) {
                    throw new Error(`The route must start with the baseUrl ${baseUrl}, but was ${route}. This is a bug, please report it.`);
                }
                if (route === "404.html") {
                    // Do not index error page.
                    return [];
                }
                if (indexDocs) {
                    for (const docsPlugin of docsPlugins.values()) {
                        const docsBasePath = trimTrailingSlash(docsPlugin.options.routeBasePath);
                        const docsTagsPath = docsPlugin.options.tagsBasePath;
                        if (urlMatchesPrefix(route, docsBasePath)) {
                            if (urlMatchesPrefix(route, trimLeadingSlash(`${docsBasePath}/${docsTagsPath}`)) ||
                                urlMatchesPrefix(route, trimLeadingSlash(`${docsBasePath}/__docusaurus`))) {
                                // Do not index tags filter pages and pages generated by the debug plugin
                                return [];
                            }
                            return {
                                route,
                                url,
                                type: "docs",
                            };
                        }
                    }
                }
                if (indexBlog) {
                    for (const blogPlugin of blogPlugins.values()) {
                        const blogBasePath = trimTrailingSlash(blogPlugin.options.routeBasePath);
                        const blogTagsPath = blogPlugin.options.tagsBasePath;
                        if (urlMatchesPrefix(route, blogBasePath)) {
                            if (route === blogBasePath ||
                                urlMatchesPrefix(route, trimLeadingSlash(`${blogBasePath}/${blogTagsPath}`)) ||
                                urlMatchesPrefix(route, trimLeadingSlash(`${blogBasePath}/__docusaurus`))) {
                                // Do not index list of blog posts, tags filter pages, and pages generated by the debug plugin
                                return [];
                            }
                            return {
                                route,
                                url,
                                type: "blog",
                            };
                        }
                    }
                }
                if (indexPages) {
                    for (const pagesPlugin of pagesPlugins.values()) {
                        const pagesBasePath = trimTrailingSlash(pagesPlugin.options.routeBasePath);
                        if (urlMatchesPrefix(route, pagesBasePath)) {
                            if (urlMatchesPrefix(route, trimLeadingSlash(`${pagesBasePath}/__docusaurus`))) {
                                // Do not index pages generated by the debug plugin
                                return [];
                            }
                            return {
                                route,
                                url,
                                type: "page",
                            };
                        }
                    }
                }
                return [];
            })
                .map(({ route, url, type }) => {
                const file = trailingSlash === false
                    ? path_1.default.join(outDir, `${route === "" ? "index" : route}.html`)
                    : path_1.default.join(outDir, route, "index.html");
                return {
                    file,
                    url,
                    type,
                };
            });
            logger_1.default.info("Parsing documents");
            // Give every index entry a unique id so that the index does not need to store long URLs.
            let nextDocId = 1;
            const documents = (await Promise.all(data.map(async ({ file, url, type }) => {
                logger_1.default.debug(`Parsing ${type} file ${file}`, { url });
                const html = await readFileAsync(file, { encoding: "utf8" });
                const { pageTitle, sections, docSidebarParentCategories } = (0, parse_1.html2text)(html, type, url);
                const tag = (0, parse_1.getDocusaurusTag)(html);
                return sections.map((section) => ({
                    id: nextDocId++,
                    pageTitle,
                    pageRoute: url,
                    sectionRoute: url + section.hash,
                    sectionTitle: section.title,
                    sectionContent: section.content,
                    tag,
                    docSidebarParentCategories,
                    type,
                }));
            }))).flat();
            const documentsByTag = documents.reduce((acc, doc) => {
                acc[doc.tag] = acc[doc.tag] ?? [];
                acc[doc.tag].push(doc);
                return acc;
            }, {});
            logger_1.default.info(`${Object.keys(documentsByTag).length} indexes will be created.`);
            await Promise.all(Object.entries(documentsByTag).map(async ([tag, documents]) => {
                logger_1.default.info(`Building index ${tag} (${documents.length} documents)`);
                const index = lunr(function () {
                    if (language !== "en") {
                        if (Array.isArray(language)) {
                            // @ts-expect-error
                            this.use(lunr.multiLanguage(...language));
                        }
                        else {
                            // @ts-expect-error
                            this.use(lunr[language]);
                        }
                    }
                    this.k1(k1);
                    this.b(b);
                    this.ref("id");
                    this.field("title");
                    this.field("content");
                    if (indexDocSidebarParentCategories > 0) {
                        this.field("sidebarParentCategories");
                    }
                    const that = this;
                    documents.forEach(({ id, sectionTitle, sectionContent, docSidebarParentCategories, }) => {
                        let sidebarParentCategories;
                        if (indexDocSidebarParentCategories > 0 &&
                            docSidebarParentCategories) {
                            sidebarParentCategories = docSidebarParentCategories
                                .reverse()
                                .slice(0, indexDocSidebarParentCategories)
                                .join(" ");
                        }
                        that.add({
                            id: id.toString(),
                            title: sectionTitle,
                            content: sectionContent,
                            sidebarParentCategories,
                        });
                    });
                });
                await writeFileAsync(path_1.default.join(outDir, `search-index-${tag}.json`), JSON.stringify({
                    documents: documents.map(({ id, pageTitle, sectionTitle, sectionRoute, type, }) => ({
                        id,
                        pageTitle,
                        sectionTitle,
                        sectionRoute,
                        type,
                    })),
                    index,
                }), { encoding: "utf8" });
                logger_1.default.info(`Index ${tag} written to disk`);
            }));
        },
    };
}
exports.default = cmfcmfDocusaurusSearchLocal;
function validateOptions({ options, validate, }) {
    return validate(optionsSchema, options);
}
exports.validateOptions = validateOptions;
