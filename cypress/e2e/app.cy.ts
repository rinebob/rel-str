describe('App Root E2E', () => {
    it('should load the app and display the main layout', () => {
      cy.visit('/');
  
      // Check for header text
      cy.contains('Relative Strength Heatmap').should('be.visible');
  
      // Check for navigation buttons
      cy.contains('DOCUMENTATION').should('be.visible');
      cy.contains('CONTACT').should('be.visible');
      cy.contains('SIGNUP').should('be.visible');
      cy.contains('LOGIN').should('be.visible');
  
      // Check for default content (from home or dashboard)
      cy.contains('home works!').should('be.visible');
    });
  
    // Example: Test navigation if buttons are links
    it('should navigate to the login page', () => {
      cy.visit('/');
      cy.contains('LOGIN').click();
      // Update this selector/text to match your login page
      cy.url().should('include', '/login');
      // cy.contains('Login').should('be.visible'); // Uncomment if login page has a unique text
    });
  });