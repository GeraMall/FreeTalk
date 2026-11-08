package io.freetalk.mobile

import java.time.LocalDate

internal object AuthValidation {
    fun email(value: String) = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$").matches(value.trim())
    fun username(value: String) = Regex("^[a-z0-9_]{5,24}$").matches(value.trim().removePrefix("@").lowercase())
    fun password(value: String) = value.length in 10..256 &&
        Regex("[A-Za-zА-Яа-я]").containsMatchIn(value) && Regex("[0-9]").containsMatchIn(value)
    fun birthDate(day: String, month: String, year: String, today: LocalDate = LocalDate.now()): String? =
        runCatching {
            val date = LocalDate.of(year.toInt(), month.toInt(), day.toInt())
            if (date.year < 1900 || date > today) null else date.toString()
        }.getOrNull()
}
