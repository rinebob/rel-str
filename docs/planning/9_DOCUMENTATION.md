# Documentation - Relative Strength Heatmap (MVP) - Combined (Revised)

## 1. Introduction

This document outlines the documentation plan for the Minimum Viable Product (MVP) of the Relative Strength Heatmap (RSH) application, covering both developer and user-facing documentation. A comprehensive and accessible documentation set is crucial for facilitating development, maintenance, onboarding new contributors, and enabling users to effectively utilize the application.

## 2. Types of Documentation

The project will maintain the following types of documentation, categorized for different audiences and purposes:

* **Developer Documentation:**
    * **Code-level Documentation:** Inline comments within the source code written using the JSDoc standard. This documents functions, classes, modules, parameters, return values, complex logic blocks, and any non-obvious implementation details directly where the code resides. This is the most granular level of documentation.
    * **Generated Documentation Site:** An automated process, configured in the CI/CD pipeline, will generate a static HTML documentation website directly from the JSDoc comments in the codebase.
        * *Instructions to Generate Site (Example):*
            1.  Ensure JSDoc is installed as a development dependency (e.g., run `npm install --save-dev jsdoc` in the project root).
            2.  Run the JSDoc command from the project root, specifying the source files or folders to process (e.g., `npx jsdoc -d docs/jsdoc-site src/path/to/your/code`). Configuration options can be specified via a `jsdoc.json` file to customize the output.
            3.  The generated HTML documentation website will be placed in the specified output directory (e.g., `./docs/jsdoc-site`).
    * **Architectural/Strategy Documentation:** Markdown (`.md`) files stored in the code repository that provide high-level documentation on technical decisions, overall architecture, and key strategies. Examples include:
        * `prd.md` (Product Requirements Document)
        * `frontend.md`
        * `backend.md`
        * `state-management.md`
        * `database-schema.md`
        * `api.md`
        * `devops.md`
        * `testing.md`
        * `security.md`
        * `performance-optimization.md`
        * `user-flow.md`
        * `third-party-libraries.md`
    * **Project README:** A comprehensive `README.md` file located in the root of the code repository. This serves as the primary entry point for anyone interacting with the codebase, containing essential information such as project overview, setup instructions (installation, dependencies), how to run the application locally, how to run the test suite, and contribution guidelines.
* **User Guide:**
    * Documentation specifically for the end-users of the Relative Strength Heatmap application. This explains how to navigate the application, use core features like the heatmap and charts, manage stock lists, interpret the data visualizations (including relative strength concepts as applied in the app), and understand account settings. It will be written in clear, non-technical language.
* **Product Roadmap:**
    * A public-facing document or page outlining planned features, upcoming developments, and the overall direction of the application beyond the MVP. This may include a mechanism for users to suggest and vote on potential new features to help prioritize future work.

## 3. Storage Locations

The documentation assets will be stored and accessed as follows:

* **Code-level Documentation (JSDoc Comments) & Project README:** Stored directly within the main application code repository (e.g., on GitHub).
* **Generated Documentation Site:** Hosted as a static website on Firebase Hosting. This can be configured on a dedicated subdomain (e.g., `devdocs.relative-strength-heatmap.app`) or a specific path within the main application domain (e.g., `relative-strength-heatmap.app/devdocs`).
* **Architectural/Strategy Documentation (.md files):** Stored directly within the main application code repository, typically organized in a dedicated `docs` folder at the root level.
* **User Guide:** Hosted as a specific page or section within the main application website (hosted on Firebase Hosting), accessible to users directly from the application interface or landing page.
* **Product Roadmap:** Hosted as a specific page or section within the main application website, potentially alongside the User Guide.

## 4. Update Strategy

Maintaining up-to-date documentation is critical. The following strategy will be employed:

* **Code-level Documentation:** Developers are responsible for updating JSDoc comments concurrently as code is written, modified, or refactored. The automated CI/CD pipeline will regenerate the documentation site automatically upon relevant code merges, ensuring the hosted developer documentation is always current with the codebase.
* **Architectural/Strategy Documentation:** Updated manually by developers and the project lead as technical decisions are made, architectural changes occur, or development strategies evolve. Updates should be treated as part of the development process for significant changes.
* **User Guide:** Updated incrementally as new features are developed and released in the application. Documentation updates for new features will be included as part of the release process before the feature is made available to users.
* **Product Roadmap:** Updated periodically (e.g., monthly or quarterly) by the product owner/developer to reflect changes in development priorities, progress on planned features, and incorporation of user feedback or new ideas. User suggestions submitted through any planned mechanism will be reviewed on a regular basis and potentially incorporated into the roadmap.

## 5. Documentation for AI Assistance

A conscious effort will be made to create well-structured architectural documents, clear and comprehensive code-level JSDoc comments, and utilize descriptive naming conventions throughout the code. This focus on clarity and structure is intended to make the codebase and its associated documentation highly amenable to understanding, analysis, and assistance from AI-powered development tools, facilitating future development and debugging efforts.