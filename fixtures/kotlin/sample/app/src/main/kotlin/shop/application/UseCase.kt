package shop.application

import jakarta.inject.Singleton

@Target(AnnotationTarget.CLASS)
@Retention(AnnotationRetention.RUNTIME)
@Singleton
annotation class UseCase
