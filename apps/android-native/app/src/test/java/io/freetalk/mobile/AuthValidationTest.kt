package io.freetalk.mobile

import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class AuthValidationTest {
    @Test fun registrationAndRecoveryUseTheServerPasswordRequirements() {
        assertFalse(AuthValidation.password("lettersOnly"))
        assertFalse(AuthValidation.password("1234567890"))
        assertFalse(AuthValidation.password("abc12345"))
        assertTrue(AuthValidation.password("Valid12345"))
        assertTrue(AuthValidation.password("Буквы12345"))
    }
    @Test fun birthDateRejectsImpossibleDatesAndAcceptsLeapYears() {
        val today = LocalDate.of(2026, 11, 8)
        assertNull(AuthValidation.birthDate("29", "2", "2001", today))
        assertNull(AuthValidation.birthDate("1", "1", "2027", today))
        assertNull(AuthValidation.birthDate("1", "1", "1899", today))
        assertNull(AuthValidation.birthDate("", "1", "2000", today))
        assertEquals("2000-02-29", AuthValidation.birthDate("29", "2", "2000", today))
    }
    @Test fun usernamesAndEmailsMatchTheCurrentRegistrationContract() {
        assertFalse(AuthValidation.username("abc"))
        assertTrue(AuthValidation.username("@german_1"))
        assertFalse(AuthValidation.email("neman"))
        assertFalse(AuthValidation.email("a@b"))
        assertTrue(AuthValidation.email("user@example.com"))
    }
}
